// cloudfunctions/admin/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COL_USER = 'users';
const COL_GOODS = 'goods';
const COL_REPORT = 'reports';
const COL_CAT = 'categories';
const COL_PICKUP = 'pickup_points';
const COL_ORDER = 'orders';
const COL_REVIEW = 'reviews';
const COL_MESSAGE = 'messages';
const SENSITIVE = require('./sensitive-words.js');

const ok = d => ({ code: 0, data: d });
const fail = (msg, code = 1) => ({ code, msg });

/**
 * 写入自愈：云开发 add 到「不存在的集合」会抛 -502005，不会自动建集合。
 * 捕获 -502005 后先 createCollection 再重试，避免空库首次写入（审计日志/初始化种子数据）直接 500。
 */
async function ensureAdd(collection, data) {
  try { return await db.collection(collection).add({ data }); }
  catch (e) {
    const msg = (e && e.message) || '';
    const code = e && e.errCode;
    if (code === -502005 || msg.indexOf('not exists') !== -1 || msg.indexOf('ResourceNotFound') !== -1) {
      try { await db.createCollection(collection); } catch (e2) { console.error('createCollection fail', collection, e2 && e2.message); }
      return await db.collection(collection).add({ data });
    }
    throw e;
  }
}

const MAX_PAGE_SIZE = 50;
const clampPage = (page, pageSize, def = 20) => ({
  p: Math.max(1, Number(page) || 1),
  size: Math.max(1, Math.min(MAX_PAGE_SIZE, Number(pageSize) || def))
});

/**
 * 给云存储临时 URL 追加 COS 图片处理参数（数据万象 imageMogr2），让渲染层直接拿小图。
 * 【务必用 `&` 追加】临时 URL 形如 `...?sign=xxx&t=xxx`，覆盖查询串会让签名失效 403。
 */
function imgThumb(url, width = 1080, quality = 80) {
  if (typeof url !== 'string' || url.indexOf('http') !== 0) return url;
  if (url.indexOf('imageMogr2') >= 0) return url;
  if (url.indexOf('tcb.qcloud.la') < 0 && url.indexOf('myqcloud.com') < 0) return url;
  return url + '&imageMogr2/thumbnail/' + width + 'x/format/jpg/quality/' + quality;
}

/**
 * 后台同样必须把 cloud:// 换成 https —— 否则后台页面里的商品缩略图、举报凭证图全部裂图。
 * 此前 goods / user / chat / order 都做了这一步，唯独 admin 漏了，是本轮
 * 「管理后台整片 Failed to load image」的根因。
 * @returns {Promise<Object>} fileID → https 临时链接
 */
async function resolveImgs(fileIds, width = 1080) {
  const uniq = [...new Set((fileIds || []).filter(f => typeof f === 'string' && f.indexOf('cloud://') === 0))];
  const map = {};
  if (!uniq.length) return map;
  try {
    const tr = await cloud.getTempFileURL({ fileList: uniq });
    (tr.fileList || []).forEach(it => { if (it.tempFileURL) map[it.fileID] = imgThumb(it.tempFileURL, width); });
  } catch (e) { console.error('admin resolveImgs fail', e && e.message); }
  return map;
}
const THUMB_ADMIN = 1080;   // 后台看的是缩略图/凭证，1080 兼顾清晰度与体积
const THUMB_AVATAR = 200;

/** 头像兜底：wxfile:// / http:// 是失效临时路径 → 清空走默认头像 */
function cleanAvatar(url) {
  if (!url) return '';
  if (String(url).indexOf('wxfile://') === 0 || String(url).indexOf('http://') === 0) return '';
  return url;
}

// 管理员白名单（与 user 云函数保持一致；需变更管理员时改这里并重新部署）
const ADMIN_OPENIDS = [
  'o5NAjxrVqSopwCl-rnh0cwjv1auE' // 陈思锐（创建者）
];

function isWhitelistAdmin(openid) {
  return ADMIN_OPENIDS.indexOf(openid) !== -1;
}

async function isAdmin(openid) {
  if (isWhitelistAdmin(openid)) return true;
  const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
  return !!(u.data && u.data[0] && u.data[0].isAdmin);
}

async function requireAdmin(openid) {
  if (!(await isAdmin(openid))) throw Object.assign(new Error('无管理员权限'), { _code: 403 });
}

/**
 * 让首页/列表的服务端缓存立即失效：跨函数通知 goods 实例（action=markDirty）。
 * 管理员的每次「下架 / 上架 / 禁售 / 二次审核」后调用一次，配合前端 cm_home_dirty，
 * 实现「操作后首页商品列表快速自动刷新，无明显延迟」。
 * 失败不阻断主流程（缓存最多 TTL 窗口内旧一档，不应让管理操作整体失败）。
 */
async function bumpGoodsList() {
  try { await cloud.callFunction({ name: 'goods', data: { action: 'markDirty' } }); }
  catch (e) { console.warn('bumpGoodsList fail', e && e.message); }
}

/**
 * 关键词转义：把用户输入里的正则元字符（. * ( ) [ ] 等）转成字面量，
 * 避免「搜一个 `.` 匹配所有」以及潜在的 ReDoS。
 */
function escapeRegex(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 学号打码：列表场景无需完整学号，避免批量泄露 */
function maskStudentId(id) {
  const s = String(id || '');
  if (s.length <= 4) return s;
  return s.slice(0, 4) + '*'.repeat(Math.max(1, s.length - 6)) + s.slice(-2);
}

/** 敏感信息访问审计：谁在什么时候看了谁的资料 */
async function logSensitiveAccess(openid, action, target) {
  await ensureAdd('admin_logs', { action: 'viewSensitive:' + action, targetOpenid: target, operator: openid, createdAt: Date.now() }).catch(() => {});
}

/**
 * 读取「可能尚未创建」的集合：集合不存在时云数据库抛 -502005，直接透传会整页 500。
 * 统一降级为空列表（与写入侧的 ensureAdd 呼应）。
 */
async function readSafe(run) {
  try { return await run(); }
  catch (e) {
    console.warn('readSafe fallback:', (e && e.message) || e);
    return { data: [] };
  }
}

/** 简易敏感词命中检查 */
function hitSensitive(text) {
  if (!text || typeof text !== 'string') return null;
  return SENSITIVE.SENSITIVE_WORDS.find(w => text.indexOf(w) !== -1) || null;
}

/**
 * 并行分批删除某集合里匹配 where 的全部文档，返回删除条数。
 *
 * 为什么必须并行分批：原先各处用 `for (const x of list) await doc.remove()` ——
 * 串行时每删一条要等一次网络往返；clearUser 最坏要删 1200 条（商品100+评价200+
 * 收藏200+消息500+举报200），串行**必定触发 -504003 云函数超时**，且删到一半中断
 * 留下一半脏数据（比不删更糟：用户记录还在、关联数据缺一半）。
 * 改为「每批 100 条 Promise.all 并发 + 循环取到不足一批为止」，同时覆盖 >1000 条
 * 的场景（单次 .limit() 上限 1000，一次取不完会静默漏删）。
 *
 * @param {string}   collection 集合名
 * @param {object}   where      查询条件
 * @param {function} onEach     每成功删除一条的回调（可选，用于计数）
 */
async function removeAllBy(collection, where, onEach) {
  const BATCH = 100;
  let total = 0;
  const MAX_LOOPS = 50; // 安全阀：最多 5000 条，防止异常数据导致死循环
  for (let i = 0; i < MAX_LOOPS; i++) {
    const r = await db.collection(collection).where(where).limit(BATCH).get().catch(() => ({ data: [] }));
    if (!r.data || !r.data.length) break;
    const results = await Promise.all(r.data.map(x =>
      db.collection(collection).doc(x._id).remove().then(() => true).catch(() => false)
    ));
    const okCount = results.filter(Boolean).length;
    total += okCount;
    if (onEach) onEach(okCount);
    if (r.data.length < BATCH) break;
  }
  return total;
}

const handlers = {
  async pendingReports({ page = 1, pageSize = 20, status = 'pending' } = {}, openid) {
    await requireAdmin(openid);
    const { p, size } = clampPage(page, pageSize);
    const where = {};
    // status 缺省查「待处理」；传 'all' 查全部；传 'resolved'/'rejected' 查已处理归档
    if (status && status !== 'all') where.status = status;
    // reports 集合在从未有举报时可能不存在 → 降级为空列表而不是 500
    const r = await readSafe(() => db.collection(COL_REPORT)
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip((p - 1) * size).limit(size).get());
    // 举报凭证图：cloud:// → https（否则后台「举报」tab 的凭证图全部裂图）
    const rFileIds = [];
    r.data.forEach(x => (x.images || []).forEach(f => rFileIds.push(f)));
    const rUrlMap = await resolveImgs(rFileIds, THUMB_ADMIN);
    const list = r.data.map(x => ({ ...x, images: (x.images || []).map(f => rUrlMap[f] || f) }));

    // —— 富化：被举报商品/用户的上下文（只读，便于管理员核实后下架，不改动商品管理模块）——
    const goodsIds = [];
    const userIds = [];
    list.forEach(x => {
      if (x.targetType === 'goods' && x.targetId) goodsIds.push(x.targetId);
      else if (x.targetType === 'user' && x.targetId) userIds.push(x.targetId);
    });
    if (goodsIds.length) {
      const gs = await readSafe(() => db.collection(COL_GOODS).where({ _id: _.in(goodsIds) }).limit(100).get());
      const gMap = {};
      (gs.data || []).forEach(g => { gMap[g._id] = g; });
      const gFileIds = [];
      (gs.data || []).forEach(g => { if (g.cover) gFileIds.push(g.cover); });
      const gUrlMap = await resolveImgs(gFileIds, THUMB_ADMIN);
      const sellerOpenids = [...new Set((gs.data || []).map(g => g._openid))];
      let sellerMap = {};
      if (sellerOpenids.length) {
        const us = await readSafe(() => db.collection(COL_USER).where({ _openid: _.in(sellerOpenids) }).field({ _openid: true, nickName: true }).limit(200).get());
        (us.data || []).forEach(u => { sellerMap[u._openid] = u.nickName || ''; });
      }
      list.forEach(x => {
        if (x.targetType === 'goods' && gMap[x.targetId]) {
          const g = gMap[x.targetId];
          x.goodsTitle = g.title || '';
          x.goodsCover = gUrlMap[g.cover] || g.cover || '';
          x.goodsStatus = g.status || '';
          x.goodsSeller = sellerMap[g._openid] || '';
        }
      });
    }
    if (userIds.length) {
      const us = await readSafe(() => db.collection(COL_USER).where({ _openid: _.in(userIds) }).field({ _openid: true, nickName: true }).limit(200).get());
      const um = {};
      (us.data || []).forEach(u => { um[u._openid] = u.nickName || ''; });
      list.forEach(x => { if (x.targetType === 'user') x.targetNick = um[x.targetId] || x.targetId; });
    }
    return ok({ list, hasMore: r.data.length === size });
  },

  async handleReport({ id, pass, action, handleAction, note, status }, openid) {
    await requireAdmin(openid);
    const r = await db.collection(COL_REPORT).doc(id).get();
    if (!r.data) return fail('举报不存在', 404);
    const rep = r.data;

    // 管理员可重新打开已处理/已驳回的举报，回到待处理状态进行二次处理
    if (status === 'pending') {
      await db.collection(COL_REPORT).doc(id).update({
        data: {
          status: 'pending',
          handleResult: _.remove(),
          handleNote: _.remove(),
          handledAt: _.remove(),
          handler: _.remove()
        }
      });
      return ok({ ok: true });
    }

    const act = handleAction || (['off_goods', 'ban_user'].includes(action) ? action : '');
    const data = {
      status: pass ? 'resolved' : 'rejected',
      handleResult: act || (pass ? '已处理' : '驳回'),
      handleNote: note || '',
      handledAt: Date.now(),
      handler: openid
    };
    await db.collection(COL_REPORT).doc(id).update({ data });
    if (pass && act === 'off_goods' && rep.targetType === 'goods') {
      const now = Date.now();
      // 举报下架：**不删除记录**，标记 offType='report' 并进入「二次审核」队列（recheck=true），
      // 由审核人员在「商品管理 · 待二次审核」复核后决定是否重新上架 / 禁售 / 维持下架。
      await db.collection(COL_GOODS).doc(rep.targetId).update({
        data: {
          status: 'off', offType: 'report',
          offReason: note || '管理员处理举报下架',
          offAt: now, offBy: openid,
          recheck: true, recheckAt: now, updatedAt: now
        }
      }).catch(() => {});
      await bumpGoodsList(); // 首页列表缓存失效 → 快速同步
    }
    if (pass && act === 'ban_user') {
      let targetOpenid = rep.targetType === 'user' ? rep.targetId : null;
      if (!targetOpenid && rep.targetType === 'goods') {
        const g = await db.collection(COL_GOODS).doc(rep.targetId).get().catch(() => null);
        if (g && g.data) targetOpenid = g.data._openid;
      }
      if (targetOpenid) {
        const u = await db.collection(COL_USER).where({ _openid: targetOpenid }).limit(1).get();
        if (u.data && u.data.length) {
          await db.collection(COL_USER).doc(u.data[0]._id).update({ data: { status: 'banned', bannedAt: Date.now() } });
        }
      }
    }
    // 举报处理落审计：便于追溯下架/封禁/驳回操作，与商品管理模块审计独立不冲突
    await ensureAdd('admin_logs', {
      action: 'handleReport', targetId: rep.targetId, targetType: rep.targetType,
      pass: !!pass, handleAction: act, note: note || '', operator: openid, createdAt: Date.now()
    }).catch(() => {});
    return ok({ ok: true });
  },

  async stats(_event, openid) {
    await requireAdmin(openid);
    const [users, goods, onSale, sold, reserved, off, pendingGoods, reports, pendingRep, pendingVerify, banned, bannedGoods, recheckGoods] = await Promise.all([
      db.collection(COL_USER).count(),
      db.collection(COL_GOODS).count(),
      db.collection(COL_GOODS).where({ status: 'onSale' }).count(),
      db.collection(COL_GOODS).where({ status: 'sold' }).count(),
      db.collection(COL_GOODS).where({ status: 'reserved' }).count(),
      db.collection(COL_GOODS).where({ status: 'off' }).count(),
      db.collection(COL_GOODS).where({ status: 'pending' }).count(),
      db.collection(COL_REPORT).count(),
      db.collection(COL_REPORT).where({ status: 'pending' }).count(),
      db.collection(COL_USER).where({ 'verifyApply.status': 'pending' }).count(),
      db.collection(COL_USER).where({ status: 'banned' }).count(),
      db.collection(COL_GOODS).where({ status: 'banned' }).count(),
      db.collection(COL_GOODS).where({ recheck: true }).count()
    ]);
    return ok({
      users: users.total, goods: goods.total,
      onSale: onSale.total, sold: sold.total, reserved: reserved.total, off: off.total,
      pendingGoods: pendingGoods.total,
      reports: reports.total, pendingReports: pendingRep.total,
      pendingVerify: pendingVerify.total,
      banned: banned.total,
      bannedGoods: bannedGoods.total,
      recheckGoods: recheckGoods.total
    });
  },

  /** 用户列表（支持按昵称/学号/学校/实名/openid 搜索，按注册时间倒序） */
  async listUsers({ keyword = '', status = '', page = 1, pageSize = 20 } = {}, openid) {
    await requireAdmin(openid);
    const { p, size } = clampPage(page, pageSize);
    const where = {};
    if (status === 'banned') where.status = 'banned';
    else if (status === 'verified') where.verified = true;
    else if (status === 'unverified') where.verified = _.neq(true);
    else if (status === 'pending') where['verifyApply.status'] = 'pending';
    // ⚠️ 关键词必须在 DB 层过滤。
    // 原写法是「skip+limit 取 20 条 → 内存 filter」，等于只搜「当前页」：
    // 库里 1000 人时，第 20 名之后的匹配永远搜不到（用户会以为「搜不到=不存在」）。
    const conds = [];
    if (Object.keys(where).length) conds.push(where);
    const kw = String(keyword == null ? '' : keyword).trim();
    if (kw) {
      const re = db.RegExp({ regexp: escapeRegex(kw), options: 'i' });
      // 「或」条件必须提到顶层用 _.or —— 赋值给单个字段会被云开发静默忽略
      conds.push(_.or([
        { nickName: re }, { studentId: re }, { school: re },
        { _openid: re }, { 'verifyApply.realName': re }
      ]));
    }
    let query = db.collection(COL_USER);
    if (conds.length) query = query.where(conds.length === 1 ? conds[0] : _.and(conds));
    const r = await query.orderBy('createdAt', 'desc')
      .skip((p - 1) * size).limit(size).get();
    // 统计每个用户的商品数。
    // ⚠️ 此前用 `where({_openid: _.in(openids)}).count()` —— count() 不支持聚合，
    //    拿到的是「这批人的商品总数」，却贴给每一个用户，导致**每人显示同一个错误数字**。
    //    改为按 openid 分组实数（用 get 取 _openid 字段后本地归类，openid 数量有限、开销可控）。
    const openids = r.data.map(u => u._openid);
    let goodsMap = {};
    let soldMap = {};
    if (openids.length) {
      const gs = await db.collection(COL_GOODS)
        .where({ _openid: _.in(openids) })
        .field({ _openid: true, status: true })
        .limit(1000).get().catch(() => ({ data: [] }));
      gs.data.forEach(g => {
        goodsMap[g._openid] = (goodsMap[g._openid] || 0) + 1;
        if (g.status === 'sold') soldMap[g._openid] = (soldMap[g._openid] || 0) + 1;
      });
    }
    // 头像：清掉失效临时路径（wxfile:// / http://），cloud:// 换 https 并缩放到 200
    const avMap = await resolveImgs(r.data.map(u => cleanAvatar(u.avatarUrl)), THUMB_AVATAR);
    const list = r.data.map(u => {
      const raw = cleanAvatar(u.avatarUrl);
      return {
      _openid: u._openid,
      nickName: u.nickName,
      avatarUrl: avMap[raw] || (raw.indexOf('cloud://') === 0 ? '' : raw),
      school: u.school || '',
      // 列表只展示打码学号，完整学号在用户详情里按需查看（会记审计）
      studentId: maskStudentId(u.studentId),
      education: (u.verifyApply && u.verifyApply.education) || '',
      verified: !!u.verified,
      status: u.status || 'normal',
      credit: u.credit == null ? 100 : Math.max(0, Math.min(100, Number(u.credit))),
      createdAt: u.createdAt,
      // 商品数：按 openid 精确统计（含在售/已下架/禁售等全部记录，管理后台需要看全貌）
      goodsCount: goodsMap[u._openid] || 0,
      soldCount: soldMap[u._openid] || 0,
      // 封禁信息：谁在何时因何封禁（判断是否解封的依据）
      banned: u.status === 'banned',
      bannedReason: u.bannedReason || '',
      bannedAt: u.bannedAt || 0,
      // 认证申请状态：待审核的用户要能一眼看出来
      verifyStatus: (u.verifyApply && u.verifyApply.status) || '',
      _statsApprox: false
      };
    });
    return ok({ list, hasMore: r.data.length === size });
  },

  /** 商品列表（所有状态，可按分类/状态/关键词过滤）
   *  特殊 status：'recheck' = 待二次审核队列；'removed' = 已下架 + 禁售。
   *  **只读查询，从不删除**：被下架/禁售商品始终保留在库中可被检索。
   */
  async listGoods({ status = '', keyword = '', category = '', recheck = false, page = 1, pageSize = 20 } = {}, openid) {
    await requireAdmin(openid);
    const { p, size } = clampPage(page, pageSize);
    const where = {};
    if (status === 'recheck') where.recheck = true;
    else if (status === 'removed') where.status = _.in(['off', 'banned']);
    else if (status && status !== 'all') where.status = status;
    if (recheck) where.recheck = true;
    if (category) where.category = category;
    // ⚠️ 关键词必须在 DB 层过滤（原为「取 20 条 → 内存 filter」，只能搜到当前页）。
    // 检索面覆盖：标题 / 描述 / 卖家 openid / 下架原因 / 禁售原因。
    const conds = [];
    if (Object.keys(where).length) conds.push(where);
    const kw = String(keyword == null ? '' : keyword).trim();
    if (kw) {
      const re = db.RegExp({ regexp: escapeRegex(kw), options: 'i' });
      conds.push(_.or([{ title: re }, { desc: re }, { _openid: re }, { offReason: re }, { banReason: re }]));
    }
    let query = db.collection(COL_GOODS);
    if (conds.length) query = query.where(conds.length === 1 ? conds[0] : _.and(conds));
    const r = await query.orderBy('createdAt', 'desc')
      .skip((p - 1) * size).limit(size).get();
    // 补充卖家昵称
    const openids = [...new Set(r.data.map(g => g._openid))];
    let sellerMap = {};
    if (openids.length) {
      const us = await db.collection(COL_USER).where({ _openid: _.in(openids) })
        .field({ _openid: true, nickName: true, avatarUrl: true, credit: true, verified: true, school: true }).get();
      us.data.forEach(u => { sellerMap[u._openid] = u; });
    }
    // 商品缩略图/大图：cloud:// → https（否则后台缩略图全裂）+ 缩放到 1080
    const gFileIds = [];
    r.data.forEach(g => {
      if (g.cover) gFileIds.push(g.cover);
      (g.images || []).forEach(f => gFileIds.push(f));
    });
    const gUrlMap = await resolveImgs(gFileIds, THUMB_ADMIN);

    // 审计操作人 openid → 昵称（判断「是谁下的架」很重要，只给 openid 管理员看不懂）
    const opOpenids = [...new Set(r.data
      .map(g => g.offBy || g.bannedBy || g.recheckedBy || '')
      .filter(Boolean))];
    let opMap = {};
    if (opOpenids.length) {
      const os = await db.collection(COL_USER).where({ _openid: _.in(opOpenids) })
        .field({ _openid: true, nickName: true }).get();
      os.data.forEach(u => { opMap[u._openid] = u.nickName || ''; });
    }

    // 卖家头像：cloud:// → https（否则后台卖家头像整片裂图，与封面同理）
    const avatarMap = await resolveImgs(
      Object.values(sellerMap).map(u => u && u.avatarUrl), THUMB_AVATAR
    );
    Object.keys(sellerMap).forEach(oid => {
      const u = sellerMap[oid];
      if (!u) return;
      u.avatarUrl = cleanAvatar(avatarMap[u.avatarUrl] || u.avatarUrl || '');
    });

    const list = r.data.map(g => ({
      _id: g._id,
      _openid: g._openid,
      title: g.title,
      desc: g.desc,
      cover: gUrlMap[g.cover] || g.cover || '',
      images: (g.images || []).map(f => gUrlMap[f] || f),
      price: g.price,
      originalPrice: g.originalPrice,
      category: g.category,
      condition: g.condition || '',
      type: g.type || 'sell',
      campus: g.campus || '',
      status: g.status,
      // —— 下架/禁售审计字段（保留可查）——
      offType: g.offType || '',
      offReason: g.offReason || '',
      banReason: g.banReason || '',
      offAt: g.offAt || 0,
      bannedAt: g.bannedAt || 0,
      // 操作人：优先取与「当前生效状态」对应的那个操作人
      offBy: g.offBy || '',
      offByName: opMap[g.offBy] || '',
      bannedBy: g.bannedBy || '',
      bannedByName: opMap[g.bannedBy] || '',
      // —— 二次审核轨迹 ——
      recheck: !!g.recheck,
      recheckAt: g.recheckAt || 0,
      recheckedAt: g.recheckedAt || 0,
      recheckDecision: g.recheckDecision || '',
      recheckNote: g.recheckNote || '',
      recheckedByName: opMap[g.recheckedBy] || '',
      // —— 图片内容安全检测（判断「为何无法上架」的关键依据）——
      // pending=待检测 / safe=安全 / risky=违规(已自动禁售)
      imgCheckStatus: g.imgCheckStatus || 'safe',
      createdAt: g.createdAt,
      updatedAt: g.updatedAt || 0,
      reviewedAt: g.reviewedAt || 0,
      viewCount: g.viewCount || 0,
      favCount: g.favCount || 0,
      wantCount: g.wantCount || 0,
      seller: sellerMap[g._openid] || { _openid: g._openid, nickName: '(已注销)' }
    }));
    return ok({ list, hasMore: r.data.length === size });
  },

  /** 查看单个用户详情（管理员视角，只读）
   *  注意：会返回学信网验证码与证件截图——审核确需这些信息，
   *  因此不脱敏，改为落审计日志，做到可追溯。
   */
  async getUserDetail({ openid: target }, openid) {
    await requireAdmin(openid);
    if (!target) return fail('缺少 openid');
    const u = await db.collection(COL_USER).where({ _openid: target }).limit(1).get();
    if (!u.data || !u.data.length) return fail('用户不存在', 404);
    const user = u.data[0];
    const [goodsCount, orderCount, soldCount, buyCount, reviewCount] = await Promise.all([
      db.collection(COL_GOODS).where({ _openid: target }).count(),
      db.collection(COL_ORDER).where({ sellerId: target }).count(),
      db.collection(COL_GOODS).where({ _openid: target, status: 'sold' }).count(),
      db.collection(COL_ORDER).where({ buyerId: target }).count(),
      db.collection(COL_REVIEW).where({ _openid: target }).count()
    ]);
    await logSensitiveAccess(openid, 'getUserDetail', target);
    // 头像与认证凭证图：cloud:// → https（详情页要能点开查看凭证原图）
    const va = user.verifyApply || null;
    const dFileIds = [cleanAvatar(user.avatarUrl)];
    if (va && Array.isArray(va.evidence)) va.evidence.forEach(f => dFileIds.push(f));
    const dMap = await resolveImgs(dFileIds, THUMB_ADMIN);
    const avatarRaw = cleanAvatar(user.avatarUrl);
    return ok({
      user: {
        _openid: user._openid,
        nickName: user.nickName,
        avatarUrl: dMap[avatarRaw] || (avatarRaw.indexOf('cloud://') === 0 ? '' : avatarRaw),
        school: user.school || '',
        studentId: user.studentId || '',
        education: (user.verifyApply && user.verifyApply.education) || '',
        verified: !!user.verified,
        status: user.status || 'normal',
        credit: user.credit == null ? 100 : Math.max(0, Math.min(100, Number(user.credit))),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        verifyApply: va ? { ...va, evidence: (va.evidence || []).map(f => dMap[f] || f) } : null,
        isAdmin: !!user.isAdmin
      },
      stats: {
        goods: goodsCount.total, sold: soldCount.total,
        sellerOrders: orderCount.total, buyerOrders: buyCount.total,
        reviews: reviewCount.total
      }
    });
  },

  /** 管理员清查用户（删除账号及关联数据）
   * 仅允许清除「已封禁 / 永不认证」的可疑账号；
   * 白名单管理员不可被清除（防止误操作）
   */
  async clearUser({ openid: target, reason = '' }, openid) {
    await requireAdmin(openid);
    if (!target) return fail('缺少 openid');
    if (ADMIN_OPENIDS.indexOf(target) !== -1) return fail('白名单管理员不可清除', 403);
    const u = await db.collection(COL_USER).where({ _openid: target }).limit(1).get();
    if (!u.data || !u.data.length) return fail('用户不存在', 404);
    const user = u.data[0];
    const isBanned = user.status === 'banned';
    const isNeverVerified = !user.verified && (!user.verifyApply || user.verifyApply.status !== 'pending');
    if (!isBanned && !isNeverVerified) {
      return fail('仅可清除「已封禁」或「从未认证」的可疑账号（避免误删正常用户）', 403);
    }
    const removed = { goods: 0, orders: 0, reviews: 0, favorites: 0, wants: 0, messages: 0, reports: 0, conversations: 0, viewLogs: 0 };
    // —— 关联数据清理：全部走 removeAllBy（并行分批），避免串行 await 超时 ——
    // 商品：下架并删
    removed.goods = await removeAllBy(COL_GOODS, { _openid: target });
    // 订单（买家侧 + 卖家侧）改为匿名占位，避免历史订单断裂
    await db.collection(COL_ORDER).where({ buyerId: target }).update({
      data: { buyerNick: '已注销', buyerAvatar: '', _cleared: true }
    }).catch(() => {});
    await db.collection(COL_ORDER).where({ sellerId: target }).update({
      data: { sellerNick: '已注销', sellerAvatar: '', _cleared: true }
    }).catch(() => {});
    // 评价 / 收藏 / 想要 / 消息 / 举报：直接删除
    // ⚠️ `wants` 此前被漏清 —— 残留记录会让对应商品的 wantCount 永远不回退。
    removed.reviews = await removeAllBy(COL_REVIEW, { _openid: target });
    removed.favorites = await removeAllBy('favorites', { _openid: target });
    removed.wants = await removeAllBy('wants', { _openid: target });
    removed.messages = await removeAllBy(COL_MESSAGE, { _openid: target });
    removed.reports = await removeAllBy(COL_REPORT, { _openid: target });
    removed.viewLogs = await removeAllBy('viewLogs', { _openid: target });
    // 会话：conversations 文档**没有 `_openid` 字段**
    //（结构是 `{participants:[a,b], a, b, goodsId, goodsSnapshot, unread}`），
    // 原 `where({_openid: target})` 命中 0 条、是**空操作** ——
    // 被清用户的 openid 仍留在 participants 里，对方消息列表会出现点不开的「僵尸会话」。
    // 改为按 participants 精确清理（与 chat 的会话结构对齐）。
    removed.conversations = await removeAllBy('conversations', { participants: target });
    // 审计记录
    await ensureAdd('admin_logs', { action: 'clearUser', targetOpenid: target, operator: openid, reason, removed, createdAt: Date.now() }).catch(() => {});
    // 用户记录（最后）
    await db.collection(COL_USER).doc(user._id).remove();
    return ok({ removed, ok: true });
  },

  /** 强制解除某用户的认证状态（让用户重新填写学信网截图） */
  async forceUnverify({ openid: target, reason = '' }, openid) {
    await requireAdmin(openid);
    if (!target) return fail('缺少 openid');
    const u = await db.collection(COL_USER).where({ _openid: target }).limit(1).get();
    if (!u.data || !u.data.length) return fail('用户不存在', 404);
    await db.collection(COL_USER).doc(u.data[0]._id).update({
      data: {
        verified: false,
        'verifyApply.status': 'rejected',
        'verifyApply.reason': reason || '管理员强制重新认证',
        'verifyApply.rejectedAt': Date.now()
      }
    });
    await ensureAdd('admin_logs', { action: 'forceUnverify', targetOpenid: target, operator: openid, reason, createdAt: Date.now() }).catch(() => {});
    return ok({ ok: true });
  },

  /** 管理员下架商品（带原因）：保留记录，标记 offType='admin' 并进入二次审核队列 */
  async adminOff({ id, reason = '' }, openid) {
    await requireAdmin(openid);
    if (!id) return fail('缺少 id');
    const g = await db.collection(COL_GOODS).doc(id).get().catch(() => null);
    if (!g || !g.data) return fail('商品不存在', 404);
    if (g.data.status === 'sold') return fail('已售出商品无法下架', 403);
    const now = Date.now();
    await db.collection(COL_GOODS).doc(id).update({
      data: {
        status: 'off', offType: 'admin', offReason: reason || '管理员下架',
        offAt: now, offBy: openid, recheck: true, recheckAt: now, updatedAt: now
      }
    });
    await ensureAdd('admin_logs', { action: 'adminOff', targetId: id, operator: openid, reason, createdAt: now }).catch(() => {});
    await bumpGoodsList();
    return ok({ ok: true });
  },

  /** 管理员禁售商品：保留记录（不删除），标记 banned（offType='ban'），进入二次审核队列 */
  async banGoods({ id, reason = '' }, openid) {
    await requireAdmin(openid);
    if (!id) return fail('缺少 id');
    const g = await db.collection(COL_GOODS).doc(id).get().catch(() => null);
    if (!g || !g.data) return fail('商品不存在', 404);
    const now = Date.now();
    await db.collection(COL_GOODS).doc(id).update({
      data: {
        status: 'banned', offType: 'ban', banReason: reason || '管理员禁售',
        bannedAt: now, bannedBy: openid, recheck: true, recheckAt: now, updatedAt: now
      }
    });
    await ensureAdd('admin_logs', { action: 'banGoods', targetId: id, operator: openid, reason, createdAt: now }).catch(() => {});
    await bumpGoodsList();
    return ok({ ok: true });
  },

  /** 二次审核：审核人员查看被下架/禁售商品后决定去向（**保留记录，从不删除**）
   *  decision: 'onSale'(重新上架) | 'off'(维持下架) | 'banned'(改判禁售)
   *  处理完成后清除 recheck（出队），并记录复核人/时间/决定，便于追溯。
   */
  async recheckGoods({ id, decision, note = '' }, openid) {
    await requireAdmin(openid);
    if (!id) return fail('缺少 id');
    if (['onSale', 'off', 'banned'].indexOf(decision) === -1) return fail('非法复核决定');
    const g = await db.collection(COL_GOODS).doc(id).get().catch(() => null);
    if (!g || !g.data) return fail('商品不存在', 404);
    const cur = g.data;
    const now = Date.now();
    const base = {
      recheck: false, recheckedAt: now, recheckedBy: openid,
      recheckDecision: decision, recheckNote: note || '', updatedAt: now
    };
    let data;
    if (decision === 'onSale') {
      // 重新上架：清掉下架/禁售标记，恢复 onSale
      data = { ...base, status: 'onSale', offType: _.remove(), offReason: _.remove(), banReason: _.remove() };
    } else if (decision === 'banned') {
      data = {
        ...base, status: 'banned', offType: 'ban',
        banReason: note || cur.banReason || cur.offReason || '二次审核禁售',
        bannedAt: now, bannedBy: openid
      };
    } else {
      data = {
        ...base, status: 'off', offType: cur.offType || 'admin',
        offReason: note || cur.offReason || '二次审核维持下架',
        offAt: cur.offAt || now, offBy: cur.offBy || openid
      };
    }
    await db.collection(COL_GOODS).doc(id).update({ data });
    await ensureAdd('admin_logs', { action: 'recheckGoods', targetId: id, decision, operator: openid, note: note || '', createdAt: now }).catch(() => {});
    await bumpGoodsList();
    return ok({ ok: true, status: data.status });
  },

  /** 商品上架审核（管理后台「待审核商品」）
   *  pass=true  → 上架（onSale），并记录审核时间；
   *  pass=false → 驳回（off），记录驳回原因。
   *  审核后该商品即从「待审核」列表移除；无论上架还是驳回，
   *  仍可在「商品管理」模块查看，并可再次下架/查看详情。
   */
  async reviewGoods({ id, pass, reason = '' }, openid) {
    await requireAdmin(openid);
    if (!id) return fail('缺少 id');
    const g = await db.collection(COL_GOODS).doc(id).get().catch(() => null);
    if (!g || !g.data) return fail('商品不存在', 404);
    const now = Date.now();
    if (pass) {
      await db.collection(COL_GOODS).doc(id).update({
        data: { status: 'onSale', reviewedAt: now, offType: _.remove(), offReason: _.remove(), recheck: false }
      });
    } else {
      await db.collection(COL_GOODS).doc(id).update({
        data: { status: 'off', offType: 'reviewReject', offReason: reason || '审核未通过', offAt: now, recheck: false, reviewedAt: now }
      });
    }
    await ensureAdd('admin_logs', { action: 'reviewGoods', targetId: id, pass: !!pass, operator: openid, reason, createdAt: now }).catch(() => {});
    await bumpGoodsList(); // 审核上架 / 驳回 → 首页列表缓存失效，快速同步
    return ok({ ok: true });
  },

  /** 管理员封禁用户 */
  async adminBan({ openid: target, reason = '' }, openid) {
    await requireAdmin(openid);
    if (!target) return fail('缺少 openid');
    if (ADMIN_OPENIDS.indexOf(target) !== -1) return fail('白名单管理员不可封禁', 403);
    const u = await db.collection(COL_USER).where({ _openid: target }).limit(1).get();
    if (!u.data || !u.data.length) return fail('用户不存在', 404);
    await db.collection(COL_USER).doc(u.data[0]._id).update({
      data: { status: 'banned', bannedAt: Date.now(), bannedReason: reason, bannedBy: openid }
    });
    await ensureAdd('admin_logs', { action: 'adminBan', targetOpenid: target, operator: openid, reason, createdAt: Date.now() }).catch(() => {});
    return ok({ ok: true });
  },

  /** 管理员解封用户 */
  async adminUnban({ openid: target }, openid) {
    await requireAdmin(openid);
    if (!target) return fail('缺少 openid');
    const u = await db.collection(COL_USER).where({ _openid: target }).limit(1).get();
    if (!u.data || !u.data.length) return fail('用户不存在', 404);
    await db.collection(COL_USER).doc(u.data[0]._id).update({
      data: { status: 'normal', bannedAt: _.remove(), bannedReason: _.remove(), bannedBy: _.remove() }
    }).catch(async () => {
      // _.remove() 兜底：万一不支持，正常更新
      await db.collection(COL_USER).doc(u.data[0]._id).update({
        data: { status: 'normal' }
      });
    });
    return ok({ ok: true });
  },

  /** 管理员操作审计日志 */
  async adminLogs({ page = 1, pageSize = 30 } = {}, openid) {
    await requireAdmin(openid);
    const { p, size } = clampPage(page, pageSize, 30);
    // admin_logs 在从未产生过审计记录时并不存在 → 直接查会 -502005 抛 500（实测复现）
    const r = await readSafe(() => db.collection('admin_logs')
      .orderBy('createdAt', 'desc')
      .skip((p - 1) * size).limit(size).get());
    return ok({ list: r.data, hasMore: r.data.length === size });
  },

  /** 敏感词命中检测（管理员用来抽查内容） */
  async checkSensitive({ text }, openid) {
    await requireAdmin(openid);
    const hits = [];
    if (text && typeof text === 'string') {
      SENSITIVE.SENSITIVE_WORDS.forEach(w => { if (text.indexOf(w) !== -1) hits.push(w); });
    }
    return ok({ hits, count: hits.length, version: SENSITIVE.SENSITIVE_WORDS_VERSION });
  },

  async setAdmin({ targetOpenid, isAdmin: wantAdmin }, openid) {
    await requireAdmin(openid);
    // ⚠️ 仅白名单（超级管理员）可调整管理员权限。
    // 原先只校验 requireAdmin，而 isAdmin() 包含「被提权过的普通管理员」——
    // 于是一个普通管理员能把任意人再设为 isAdmin，权限横向扩散、失去最小权限控制。
    if (!isWhitelistAdmin(openid)) return fail('仅超级管理员可调整管理员权限', 403);
    if (ADMIN_OPENIDS.indexOf(targetOpenid) !== -1 && !wantAdmin) {
      return fail('白名单管理员不可降级', 403);
    }
    const u = await db.collection(COL_USER).where({ _openid: targetOpenid }).limit(1).get();
    if (!u.data || !u.data.length) return fail('用户不存在', 404);
    await db.collection(COL_USER).doc(u.data[0]._id).update({ data: { isAdmin: !!wantAdmin } });
    return ok({ ok: true });
  },

  async wipeGoods(_event, openid) {
    await requireAdmin(openid);
    // 走并行分批删除：原先 `limit(1000)` + 串行 for-await 既会超时，
    // 又在商品超 1000 条时**静默漏删**（单次 limit 上限 1000）。
    const removed = await removeAllBy(COL_GOODS, {});
    return ok({ removed });
  },

  async init(_event, openid) {
    // 初始化会建集合、写入分类/自提点、并可能提权，必须是管理员。
    // 白名单 openid 首次调用时 isAdmin() 返回 true，因此创建者仍能完成自我提权，
    // 不会把自己锁在门外；非管理员一律拒绝。
    await requireAdmin(openid);

    const allCols = [COL_USER, COL_GOODS, COL_REPORT, COL_CAT, COL_PICKUP, COL_ORDER, 'conversations', COL_MESSAGE, COL_REVIEW, 'favorites', 'admin_logs'];
    const created = [];
    for (const col of allCols) {
      try { await db.createCollection(col); created.push(col); } catch (e) {}
    }
    const cats = [
      { key: 'book', name: '教材书籍', icon: '📚', sort: 1 },
      { key: 'digital', name: '数码电子', icon: '💻', sort: 2 },
      { key: 'dorm', name: '宿舍神器', icon: '🛏️', sort: 3 },
      { key: 'clothes', name: '服饰鞋包', icon: '👕', sort: 4 },
      { key: 'sports', name: '运动户外', icon: '🏀', sort: 5 },
      { key: 'beauty', name: '美妆护肤', icon: '💄', sort: 6 },
      { key: 'bike', name: '代步出行', icon: '🚲', sort: 7 },
      { key: 'ticket', name: '票券卡券', icon: '🎫', sort: 8 },
      { key: 'life', name: '生活日用', icon: '🧴', sort: 9 },
      { key: 'other', name: '其他闲置', icon: '📦', sort: 99 }
    ];
    for (const c of cats) {
      const ex = await db.collection(COL_CAT).where({ key: c.key }).limit(1).get();
      if (!ex.data || !ex.data.length) await ensureAdd(COL_CAT, c);
    }
    const pickups = [
      { name: '北门驿站', desc: '靠近地铁1号线', campus: '示例大学' },
      { name: '图书馆一楼', desc: '工作日 8:00-22:00', campus: '示例大学' },
      { name: '宿舍区5号楼', desc: '楼下蜂巢柜', campus: '示例大学' },
      { name: '南门咖啡角', desc: '周末也开放', campus: '示例大学' }
    ];
    for (const p of pickups) {
      const ex = await db.collection(COL_PICKUP).where({ name: p.name }).limit(1).get();
      if (!ex.data || !ex.data.length) await ensureAdd(COL_PICKUP, { ...p, createdAt: Date.now() });
    }
    let promoted = false;
    // 仅白名单创建者调用时才自我提权；
    // 原 else 分支会把所有非白名单管理员批量降级（任意用户可调 → 管理员权限被清空），已移除。
    if (isWhitelistAdmin(openid)) {
      const me = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
      if (me.data && me.data.length && !me.data[0].isAdmin) {
        await db.collection(COL_USER).doc(me.data[0]._id).update({ data: { isAdmin: true } });
      }
      promoted = true;
    }
    return ok({ initialized: true, promoted, createdCollections: created });
  }
};

exports.main = async (event = {}) => {
  const WX = cloud.getWXContext();
  // openid 作为局部变量逐层传参，避免模块级变量在并发请求间互相覆盖
  const openid = WX.OPENID || WX.openid || '';
  if (!openid) return fail('无法识别用户身份', 401);
  const fn = handlers[event.action];
  if (!fn) return fail('未知 action: ' + event.action);
  try { return await fn(event, openid); }
  catch (e) {
    console.error(event.action, e);
    return fail(e.message || '服务器错误', e._code || 500);
  }
};
