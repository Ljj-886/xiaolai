// cloudfunctions/user/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COL_USER = 'users';
const COL_FAV = 'favorites';
const COL_WANT = 'wants';
const COL_GOODS = 'goods';
const COL_REVIEW = 'reviews';
const COL_REPORT = 'reports';
const SENSITIVE = require('./sensitive-words.js');

const COL_ORDER = 'orders';

const ADMIN_OPENIDS = [
  'o5NAjxrVqSopwCl-rnh0cwjv1auE'
];

const MAX_PAGE_SIZE = 50;
const MAX_DESC_LEN = 500;
const MAX_CONTENT_LEN = 200;
const MAX_IMAGES = 9;
const MAX_TAGS = 6;
const MAX_REASON_LEN = 50;

const clampPage = (page, pageSize, def = 20) => ({
  p: Math.max(1, Number(page) || 1),
  size: Math.max(1, Math.min(MAX_PAGE_SIZE, Number(pageSize) || def))
});

function isWhitelistAdmin(openid) {
  return ADMIN_OPENIDS.indexOf(openid) !== -1;
}

function ok(data) { return { code: 0, data }; }
function fail(msg, code = 1) { return { code, msg }; }

const CREDIT_MIN = 0;
const CREDIT_MAX = 100;
function clampCredit(c) {
  if (c == null || isNaN(Number(c))) return 100;
  return Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, Math.round(Number(c))));
}

function checkText(text) {
  if (!text || typeof text !== 'string') return '';
  const hit = SENSITIVE.SENSITIVE_WORDS.find(w => text.indexOf(w) !== -1);
  return hit ? `内容含违禁词「${hit}」` : '';
}

/**
 * 向集合写入一条记录。
 * 关键坑：微信云开发「查询/写入不存在的集合」都会抛 -502005（Db or Table not exists），
 * add 并不会像某些数据库那样自动建集合。
 * 这里在 add 失败时捕获该错误，先 createCollection 建集合再重试一次。
 * 用于 favorites / wants 这类「用户首次操作时才需要」的集合，避免老库首次点「想要/收藏」直接 500。
 */
async function ensureAdd(collection, data) {
  try {
    return await db.collection(collection).add({ data });
  } catch (e) {
    const msg = (e && e.message) || '';
    const code = e && e.errCode;
    const isMissing = code === -502005 || msg.indexOf('not exists') !== -1 || msg.indexOf('ResourceNotFound') !== -1;
    if (isMissing) {
      try {
        await db.createCollection(collection);
      } catch (e2) {
        // createCollection 在并发或集合已存在时会报错，忽略，直接进入下方重试
        console.error('createCollection 失败（可能已存在）', collection, e2 && e2.message);
      }
      return await db.collection(collection).add({ data });
    }
    throw e;
  }
}

/**
 * 按指定 _id 幂等写入（存在则覆盖）。同样带 -502005 建集合自愈。
 * 用于收藏/想要这类「确定性 _id」记录：并发重复写入只会落到同一文档，不会产生两条。
 * ⚠️ 注意：doc(id).set() 的 data 里**不能**再出现 _id 字段，否则云开发报 -501007
 *「不能更新_id的值」（_id 只能由 doc(id) 指定）。调用方方便起见可能把 _id 写进 data，
 * 这里统一剥离，避免踩坑（此前漏掉这一步，导致收藏/想要 toggle 直接 500）。
 */
async function ensureSet(collection, id, data) {
  const d = Object.assign({}, data);
  delete d._id;
  try {
    return await db.collection(collection).doc(id).set({ data: d });
  } catch (e) {
    const msg = (e && e.message) || '';
    const code = e && e.errCode;
    const isMissing = code === -502005 || msg.indexOf('not exists') !== -1 || msg.indexOf('ResourceNotFound') !== -1;
    if (isMissing) {
      try { await db.createCollection(collection); } catch (e2) { /* 已存在则忽略 */ }
      return await db.collection(collection).doc(id).set({ data: d });
    }
    throw e;
  }
}

/** 用集合**真实条数**回写计数（纠正历史 _.inc 累积误差；失败打日志、不阻断主流程） */
async function syncCount(collection, counterField, goodsId) {
  try {
    const c = await db.collection(collection).where({ goodsId }).count();
    await db.collection(COL_GOODS).doc(goodsId).update({ data: { [counterField]: c.total } });
  } catch (e) {
    console.warn('syncCount fail', collection, goodsId, e && e.message);
  }
}

/**
 * 收藏 / 想要的统一开关。
 * 原实现有两个问题：
 *   ① check-then-act 非原子：连点两次会插 2 条记录、计数 +2；
 *   ② 计数写失败被 `.catch(()=>{})` 静默吞掉 → favCount / wantCount 永久漂移、越差越多。
 * 现改为双保险：
 *   ① 记录用**确定性 _id**（`openid_goodsId`）写入，重复写入天然幂等；
 *   ② 计数改为**实时统计回写**（而非累加），天然自愈 —— 历史漂移也会被这次操作顺带纠正。
 */
async function toggleRelation(collection, counterField, goodsId, openid, flagKey) {
  if (!goodsId) return fail('缺少 goodsId');
  // 先按业务条件查（兼容历史「随机 _id」的旧记录），命中就删掉它
  let exist = { data: [] };
  try {
    exist = await db.collection(collection).where({ _openid: openid, goodsId }).limit(1).get();
  } catch (e) { exist = { data: [] }; }
  if (exist.data && exist.data.length) {
    await db.collection(collection).doc(exist.data[0]._id).remove();
    await syncCount(collection, counterField, goodsId);
    return ok({ [flagKey]: false });
  }
  const detId = `${openid}_${goodsId}`;
  await ensureSet(collection, detId, { _id: detId, _openid: openid, goodsId, createdAt: Date.now() });
  await syncCount(collection, counterField, goodsId);
  return ok({ [flagKey]: true });
}

/** 被封禁用户只读：不能评价/举报/修改资料 */
function bannedErr(me) {
  return me && me.status === 'banned' ? '账号已被封禁，无法进行该操作' : '';
}

async function getMyUser(openid) {
  const r = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
  return r.data && r.data[0];
}

/**
 * 「我的资料」返回给前端的字段白名单（**不要直接 return 整条用户文档**）。
 *
 * 背景：原先 `me` / `login` 返回整条 users 文档，会把不该给前端的字段一起下发：
 *   - `verifyApply.evidence` —— 学生证 / 学信网**证件原图**（前端从不读取，泄露面最大）
 *   - `verifyApply.agreed` / `agreedAt` / `handledAt` / `evidenceDeletedAt` 等内部流转字段
 *   - `lastActiveAt` / `updatedAt` / `publishedCount` 等前端用不到的字段
 *
 * 保留字段的依据：已逐一核对前端读取位置（缺失会导致页面信息残缺）。
 * 注意 `_openid` / `studentId` / `isAdmin` **当前有真实 UI 依赖**
 * （sold 页构造个人主页入参、verify 页回填表单、mine 页控制管理入口），暂不可删。
 */
function projectSelf(me) {
  if (!me) return null;
  const out = {
    _id: me._id,
    _openid: me._openid,
    nickName: me.nickName,
    avatarUrl: me.avatarUrl,
    school: me.school,
    studentId: me.studentId,
    realName: me.realName,
    gender: me.gender,
    education: me.education,
    verified: me.verified,
    credit: me.credit,
    isAdmin: me.isAdmin,
    createdAt: me.createdAt,
    onSaleCount: me.onSaleCount,
    soldCount: me.soldCount,
    status: me.status
  };
  // verifyApply 只放前端真正渲染的子字段（**剥离 evidence 证件图**）
  const va = me.verifyApply;
  if (va && typeof va === 'object') {
    out.verifyApply = {
      status: va.status,
      reason: va.reason,
      realName: va.realName,
      studentId: va.studentId,
      school: va.school,
      education: va.education,
      createdAt: va.createdAt
    };
  }
  return out;
}

async function isAdminUser(openid) {
  if (isWhitelistAdmin(openid)) return true;
  const me = await getMyUser(openid);
  return !!(me && me.isAdmin);
}

/**
 * 给云存储临时 URL 追加 COS 图片处理参数（数据万象 imageMogr2），让渲染层直接拿小图。
 * 实测：一张 2560x1440 / 4286.7KB 的 PNG，加 `&imageMogr2/thumbnail/1080x/format/jpg/quality/80`
 * 后返回 52.2KB JPEG（约 1/82）。既解决首屏慢，也避免渲染层因图片过大报
 * `[渲染层网络层错误] Failed to load image`。
 * 【务必用 `&` 追加】临时 URL 形如 `...?sign=xxx&t=xxx`，覆盖查询串会导致签名失效 403。
 */
function imgThumb(url, width = 750, quality = 80) {
  if (typeof url !== 'string' || url.indexOf('http') !== 0) return url;
  if (url.indexOf('imageMogr2') >= 0) return url;
  if (url.indexOf('tcb.qcloud.la') < 0 && url.indexOf('myqcloud.com') < 0) return url;
  return url + '&imageMogr2/thumbnail/' + width + 'x/format/jpg/quality/' + quality;
}
const THUMB_LIST = 750;    // 网格封面（我的商品 / 收藏）
const THUMB_AVATAR = 200;  // 头像

const handlers = {
  async me(_event, openid) {
    const me = await getMyUser(openid);
    if (!me) return fail('用户不存在', 404);
    // 一致性兜底：goods.campus 必须与 users.school 保持一致。
    // 历史原因：早期 reviewVerify 没有同步校区；已认证用户换校后旧商品会卡在原校
    // → 首页/分类按 campus 过滤后看不到。这里在 me 时静默修复存量数据，零用户操作。
    // 不限 verified：未认证但选了学校的用户也应该同步（已认证用户改学校会触发重认证、暂时 unverified）
    // 先 limit(1) 探测有无失配，无失配则零写开销。
    if (me.school) {
      try {
        const miss = await db.collection(COL_GOODS).where({
          _openid: openid, campus: _.neq(me.school)
        }).limit(1).get();
        if (miss.data && miss.data.length) {
          await db.collection(COL_GOODS).where({
            _openid: openid, campus: _.neq(me.school)
          }).update({ data: { campus: me.school, updatedAt: Date.now() } });
        }
      } catch (e) { console.error('me 时同步商品校区失败', e); }
    }
    try {
      const onSale = await db.collection(COL_GOODS).where({ _openid: openid, status: 'onSale' }).count();
      me.onSaleCount = onSale.total;
    } catch (e) { me.onSaleCount = 0; }
    me.credit = clampCredit(me.credit);
    // 头像兜底：
    //   wxfile:// / http:// → 失效的微信临时路径（chooseAvatar 返回的就是 wxfile://tmp/...），
    //                         清空让前端走默认头像
    //   cloud:// → 换 https（前端 <image> 渲染 cloud:// 可能裂图）
    //   https:// → 永久外链，原样返回
    const isTempAvatar = me.avatarUrl && (me.avatarUrl.startsWith('wxfile://') || me.avatarUrl.startsWith('http://'));
    if (isTempAvatar) {
      me.avatarUrl = '';
    } else if (me.avatarUrl && me.avatarUrl.startsWith('cloud://')) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: [me.avatarUrl] });
        if (tr.fileList && tr.fileList[0] && tr.fileList[0].tempFileURL) {
          me.avatarUrl = imgThumb(tr.fileList[0].tempFileURL, THUMB_AVATAR);
        }
      } catch (e) { console.error('getTempFileURL (me avatar) fail', e); }
    }
    return ok(projectSelf(me));
  },

  async updateProfile({ nickName, avatarUrl, school, studentId, gender }, openid) {
    const me = await getMyUser(openid);
    if (!me) return fail('用户不存在', 404);
    if (bannedErr(me)) return fail(bannedErr(me), 403);
    const data = {};
    if (nickName !== undefined) data.nickName = String(nickName).trim().slice(0, 20);
    if (avatarUrl !== undefined) {
      // 只接受云存储 fileID 或 https 链接，其余（wxfile:// 临时路径、任意字符串）一律清空。
      // 同时限长 500，避免写入超长串导致后续 <image> 渲染异常 / 文档超限。
      const a = String(avatarUrl).trim().slice(0, 500);
      data.avatarUrl = (a.startsWith('cloud://') || a.startsWith('https://')) ? a : '';
    }
    if (school !== undefined) {
      if (me.verified && school !== me.school) return fail('已认证用户修改学校需重新提交学生认证');
      data.school = String(school).trim().slice(0, 30);
    }
    if (studentId !== undefined) data.studentId = String(studentId).trim().slice(0, 20);
    if (gender !== undefined) {
      const g = String(gender);
      if (!['', '男', '女'].includes(g)) return fail('性别取值不合法');
      data.gender = g;
    }
    if (Object.keys(data).length === 0) return ok(projectSelf(me));
    data.updatedAt = Date.now();
    await db.collection(COL_USER).doc(me._id).update({ data });
    return ok({ updated: true });
  },

  async applyVerify({ realName, studentId, school, education, evidence, agreed, agreedAt }, openid) {
    const me = await getMyUser(openid);
    if (!me) return fail('用户不存在', 404);
    if (bannedErr(me)) return fail(bannedErr(me), 403);
    // 明示同意：服务端兜底校验，未勾选一律拒绝（不能只依赖前端）
    if (!agreed) return fail('请先阅读并同意《用户协议》与《隐私政策》后再提交');
    const ALLOWED_EDU = ['专科', '本科', '硕士', '博士'];
    if (!education || !ALLOWED_EDU.includes(education)) return fail('请选择最高学历（须为专科及以上）');
    if (!Array.isArray(evidence) || !evidence.length) return fail('请上传学信网在线学籍验证报告截图');
    const validEvidence = evidence.filter(f => typeof f === 'string' && f.startsWith('cloud://'));
    if (!validEvidence.length) return fail('凭证无效，请重新上传学信网截图');
    const checks = [];
    if (!realName || !String(realName).trim()) checks.push({ k: 'realName', ok: false, msg: '请填写真实姓名' });
    else {
      const n = String(realName).trim();
      const okName = (/^[\u4e00-\u9fa5·]{2,6}$/.test(n)) || (/^[A-Za-z\s.]{2,30}$/.test(n));
      checks.push({ k: 'realName', ok: okName, msg: okName ? '' : '姓名格式不正确（中文 2-6 字 或 英文 2-30 字符）' });
    }
    if (!studentId || !String(studentId).trim()) checks.push({ k: 'studentId', ok: false, msg: '请填写学号' });
    else {
      const s = String(studentId).trim();
      const okSid = /^[A-Za-z0-9]{6,15}$/.test(s);
      checks.push({ k: 'studentId', ok: okSid, msg: okSid ? '' : '学号格式不正确（6-15 位字母数字）' });
    }
    if (!school || !String(school).trim()) checks.push({ k: 'school', ok: false, msg: '请填写学校' });
    else {
      const s = String(school).trim();
      const okSch = s.length >= 4 && s.length <= 30 && !/[<>{}\\]/.test(s);
      checks.push({ k: 'school', ok: okSch, msg: okSch ? '' : '学校名格式不正确（4-30 字）' });
    }
    checks.push({ k: 'education', ok: ALLOWED_EDU.includes(education), msg: ALLOWED_EDU.includes(education) ? '' : '学历须为专科及以上' });
    const failed = checks.filter(c => !c.ok);
    const autoOk = failed.length === 0;
    const failedMsg = failed.map(f => f.msg).filter(Boolean).join('；');
    if (!autoOk) return fail('自动校验未通过：' + failedMsg);
    await db.collection(COL_USER).doc(me._id).update({
      data: {
        verifyApply: {
          realName, studentId, school, education,
          evidence: validEvidence,
          status: 'pending', createdAt: Date.now(),
          resubmit: !!me.verified,
          autoVerified: true,
          autoChecks: checks.map(c => ({ k: c.k, ok: c.ok })),
          autoVerifiedAt: Date.now(),
          // 同意留痕：记录用户已明示同意及同意时间，用于合规举证
          agreed: true,
          agreedAt: Number(agreedAt) || Date.now()
        }
      }
    });
    return ok({ submitted: true, resubmit: !!me.verified, autoVerified: true });
  },

  async listPendingVerify(_event, openid) {
    if (!(await isAdminUser(openid))) return fail('无权限', 403);
    const r = await db.collection(COL_USER)
      .where({ 'verifyApply.status': 'pending' })
      .orderBy('verifyApply.createdAt', 'desc')
      .limit(20).get();
    const list = r.data.map(u => ({
      _openid: u._openid,
      nickName: u.nickName,
      avatarUrl: u.avatarUrl,
      apply: u.verifyApply
    }));
    const fileIDs = [];
    list.forEach(it => (it.apply && it.apply.evidence || []).forEach(f => {
      if (typeof f === 'string' && f.startsWith('cloud://')) fileIDs.push(f);
    }));
    if (fileIDs.length) {
      try {
        const urlRes = await cloud.getTempFileURL({ fileList: fileIDs });
        const urlMap = {};
        urlRes.fileList.forEach(f => { if (f.fileID) urlMap[f.fileID] = f.tempFileURL || ''; });
        list.forEach(it => {
          it.apply.evidence = (it.apply.evidence || []).map(f => imgThumb(urlMap[f], THUMB_LIST) || f);
        });
      } catch (e) {}
    }
    return ok({ list });
  },

  async reviewVerify({ targetOpenid, pass, reason }, openid) {
    if (!(await isAdminUser(openid))) return fail('无权限', 403);
    const u = await db.collection(COL_USER).where({ _openid: targetOpenid }).limit(1).get();
    if (!u.data || !u.data.length) return fail('用户不存在', 404);
    const target = u.data[0];
    const data = { 'verifyApply.status': pass ? 'approved' : 'rejected', 'verifyApply.handledAt': Date.now() };
    if (pass) {
      data.verified = true;
      // 通过时清掉上一次的驳回理由，避免学生端看到过期提示
      data['verifyApply.reason'] = '';
      // 合规：兑现《隐私政策》2.3 —— 审核通过后删除学籍证明截图，仅保留审核结论。
      // 敏感个人信息在核验目的达成后应及时删除（最小必要原则）。
      data['verifyApply.evidence'] = [];
      data['verifyApply.evidenceDeletedAt'] = Date.now();
      const apply = target.verifyApply || {};
      if (apply.school) data.school = apply.school;
      if (apply.studentId) data.studentId = apply.studentId;
      if (apply.realName) data.realName = apply.realName;
      if (apply.education) data.education = apply.education;
    }
    if (!pass && reason) data['verifyApply.reason'] = reason;
    // 待删除的凭证必须在 update 之前取：update 会把 verifyApply.evidence 清空
    const pendingDelete = pass
      ? ((target.verifyApply || {}).evidence || []).filter(f => typeof f === 'string' && f.startsWith('cloud://'))
      : [];

    await db.collection(COL_USER).doc(target._id).update({ data });

    // 审核通过 → 真正删除云存储里的学籍证明图片（数据库字段已在上面清空）。
    // 删除失败只记日志，不影响审核结果，避免卡住管理员操作。
    if (pendingDelete.length) {
      try {
        await cloud.deleteFile({ fileList: pendingDelete });
      } catch (e) { console.error('reviewVerify 删除学籍证明图片失败', e); }
    }

    // 学生认证信息（学校）变更后，让该用户的全部商品归属校区同步跟随，
    // 否则换校 re-verify 后旧商品仍挂在原校、多校隔离错乱、首页看不到。
    // 这是「学生认证信息为唯一真源」原则在商品侧的落地：users.school 改了，goods.campus 也要改。
    if (pass) {
      const apply = target.verifyApply || {};
      if (apply.school) {
        try {
          await db.collection(COL_GOODS).where({ _openid: targetOpenid }).update({
            data: { campus: apply.school, updatedAt: Date.now() }
          });
        } catch (e) { console.error('reviewVerify 同步商品校区失败', e); }
      }
    }
    return ok({ handled: true });
  },

  async getPublic({ openid: target }) {
    if (!target) return fail('缺少 openid');
    const r = await db.collection(COL_USER).where({ _openid: target }).limit(1).get();
    if (!r.data || !r.data.length) return fail('用户不存在', 404);
    const u = r.data[0];
    // 头像兜底：wxfile:// / http:// 失效临时路径清空；cloud:// 换 https
    const isTempAvatar = u.avatarUrl && (u.avatarUrl.startsWith('wxfile://') || u.avatarUrl.startsWith('http://'));
    if (isTempAvatar) {
      u.avatarUrl = '';
    } else if (u.avatarUrl && u.avatarUrl.startsWith('cloud://')) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: [u.avatarUrl] });
        if (tr.fileList && tr.fileList[0] && tr.fileList[0].tempFileURL) {
          u.avatarUrl = imgThumb(tr.fileList[0].tempFileURL, THUMB_AVATAR);
        }
      } catch (e) { console.error('getTempFileURL (getPublic avatar) fail', e); }
    }
    // goods 集合可能在全新环境尚不存在 → 计数查询抛 -502005，降级为 0（不影响资料页展示）
    let sold = { total: 0 }, onSale = { total: 0 };
    try { sold = await db.collection(COL_GOODS).where({ _openid: target, status: 'sold' }).count(); } catch (e) {}
    try { onSale = await db.collection(COL_GOODS).where({ _openid: target, status: 'onSale' }).count(); } catch (e) {}
    return ok({
      _openid: u._openid,
      nickName: u.nickName, avatarUrl: u.avatarUrl,
      school: u.school, verified: u.verified,
      credit: clampCredit(u.credit), soldCount: sold.total, onSaleCount: onSale.total,
      createdAt: u.createdAt
    });
  },

  async myCredit(_event, openid) {
    const me = await getMyUser(openid);
    if (!me) return fail('用户不存在', 404);
    const credit = clampCredit(me.credit);
    // orders 集合可能在全新环境尚不存在 → 查询抛 -502005，降级为空（不影响信用分展示）
    let asSeller = { data: [] }, asBuyer = { data: [] };
    try {
      asSeller = await db.collection(COL_ORDER)
        .where({ sellerId: openid, buyerReview: _.exists(true) })
        .orderBy('buyerReview.createdAt', 'desc').limit(50).get();
    } catch (e) {}
    try {
      asBuyer = await db.collection(COL_ORDER)
        .where({ buyerId: openid, sellerReview: _.exists(true) })
        .orderBy('sellerReview.createdAt', 'desc').limit(50).get();
    } catch (e) {}
    const reviews = [];
    (asSeller.data || []).forEach(o => {
      if (o.buyerReview) reviews.push({
        // 稳定 id：评价来自订单内嵌对象，本身没有 _id；列表 wx:key 需要稳定键，
        // 用 index 会在增删时错误复用节点（渲染错乱），这里用「订单id_方向」合成。
        id: `${o._id}_byBuyer`,
        role: '卖家', score: o.buyerReview.score, tags: o.buyerReview.tags || [],
        content: o.buyerReview.content || '', goodsTitle: o.goodsTitle || '已交易商品',
        createdAt: o.buyerReview.createdAt
      });
    });
    (asBuyer.data || []).forEach(o => {
      if (o.sellerReview) reviews.push({
        id: `${o._id}_bySeller`,
        role: '买家', score: o.sellerReview.score, tags: o.sellerReview.tags || [],
        content: o.sellerReview.content || '', goodsTitle: o.goodsTitle || '已交易商品',
        createdAt: o.sellerReview.createdAt
      });
    });
    reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return ok({
      credit,
      soldCount: me.soldCount || 0,
      boughtCount: me.boughtCount || 0,
      publishedCount: me.publishedCount || 0,
      reviewCount: reviews.length,
      avgScore: reviews.length
        ? Math.round(reviews.reduce((s, r) => s + (r.score || 5), 0) / reviews.length * 10) / 10
        : null,
      reviews: reviews.slice(0, 30)
    });
  },

  async toggleFav({ goodsId }, openid) {
    return toggleRelation(COL_FAV, 'favCount', goodsId, openid, 'faved');
  },

  async toggleWant({ goodsId }, openid) {
    return toggleRelation(COL_WANT, 'wantCount', goodsId, openid, 'wanted');
  },

  async myFavs({ page = 1, pageSize = 20 } = {}, openid) {
    const { p, size } = clampPage(page, pageSize);
    // 集合不存在（从未收藏过）时返回空列表，不能让整页 500
    let favs = { data: [] };
    try {
      favs = await db.collection(COL_FAV)
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .skip((p - 1) * size).limit(size).get();
    } catch (e) {
      return ok({ list: [], hasMore: false });
    }
    if (!favs.data.length) return ok({ list: [], hasMore: false });
    const ids = favs.data.map(f => f.goodsId);
    const goodsRes = await db.collection(COL_GOODS)
      .where({ _id: _.in(ids), status: _.neq('off') }).get();
    if (!goodsRes.data.length) return ok({ list: [], hasMore: false });
    const map = {};
    goodsRes.data.forEach(g => map[g._id] = g);
    // 卖家信息（含学校，与详情/订单页保持一致）
    const openids = [...new Set(goodsRes.data.map(g => g._openid))];
    const userRes = await db.collection(COL_USER).where({ _openid: _.in(openids) })
      .field({ _openid: true, nickName: true, avatarUrl: true, verified: true, credit: true, school: true })
      .get();
    const umap = {};
    userRes.data.forEach(u => {
      umap[u._openid] = {
        nickName: u.nickName,
        avatarUrl: u.avatarUrl,
        verified: u.verified,
        credit: u.credit == null ? 100 : Math.max(0, Math.min(100, Math.round(Number(u.credit)))),
        school: u.school || ''
      };
    });
    // 图片转临时 https 链接（防止前端 <image> 无法渲染 cloud:// 协议导致裂图）。
    // 收藏页是网格视图，只展示封面 → 只解析 cover，不再解析每个商品的全部 images
    //（与 goods.list 的 light 模式同理，显著减少 getTempFileURL 的 fileID 数量）。
    const fileIds = [];
    goodsRes.data.forEach(g => {
      if (g.cover) fileIds.push(g.cover);
    });
    const uniq = [...new Set(fileIds)];
    let urlMap = {};
    if (uniq.length) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: uniq });
        tr.fileList.forEach(it => { if (it.tempFileURL) urlMap[it.fileID] = it.tempFileURL; });
      } catch (e) { console.error('myFavs getTempFileURL fail', e); }
    }
    const list = favs.data.map(f => {
      const g = map[f.goodsId];
      if (!g) return null;
      const images = (g.images || []).map(x => imgThumb(urlMap[x], THUMB_LIST) || x);
      const cover = imgThumb(urlMap[g.cover], THUMB_LIST) || g.cover || images[0] || '';
      // 剔除卖家 _openid（前端用不到，且可用于构造 chat convId）；
      // 卖家身份信息已通过 sellerInfo 白名单下发（与 goods.decorate 的策略一致）。
      const { _openid, ...rest } = g;
      return { ...rest, cover, images, faved: true, sellerInfo: umap[g._openid] || {}, _favAt: f.createdAt };
    }).filter(Boolean);
    return ok({ list, hasMore: favs.data.length === size });
  },

  async myGoods({ page = 1, pageSize = 20, status, type, category } = {}, openid) {
    const { p, size } = clampPage(page, pageSize);
    const where = { _openid: openid };
    if (status) where.status = status;
    // 分类筛选：前端（sold 页）一直在传 category，此前后端未接收 → 「我的商品」分类筛选无效。
    // 与 goods.list 一致，按 category key 精确匹配。
    if (category) where.category = category;
    // 历史数据兼容：type='want' 严格只查 want；type='sell' 含历史无 type/null 商品；其余不按 type 过滤
    // ⚠️ 同 goods.list：`where.type = _.or([{type:'sell'}, ...])` 的嵌套对象条件写法在云开发中
    //    不生效（静默失效，导致「我的商品·出售」混入求购）。统一改用 _.neq('want')。
    if (type === 'want') where.type = 'want';
    else if (type === 'sell') {
      where.type = _.neq('want');
    }
    const r = await db.collection(COL_GOODS)
      .where(where).orderBy('createdAt', 'desc')
      .skip((p - 1) * size).limit(size).get();
    // 图片转临时 https 链接：前端 <image> 无法直接渲染 cloud:// 协议，不转换会整片裂图。
    // 网格只展示封面 → 只解析 cover（与 goods.list 的 light 模式、myFavs 完全一致）。
    // 【重要】此处曾漏做 URL 解析，导致「我的商品」页图片全部不可见。
    const fileIds = r.data.map(g => g.cover).filter(f => typeof f === 'string' && f.startsWith('cloud://'));
    const uniq = [...new Set(fileIds)];
    let urlMap = {};
    if (uniq.length) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: uniq });
        tr.fileList.forEach(it => { if (it.tempFileURL) urlMap[it.fileID] = it.tempFileURL; });
      } catch (e) { console.error('myGoods getTempFileURL fail', e); }
    }
    const list = r.data.map(g => {
      // 剔除 _openid：这是「我自己的商品」，前端不需要卖家 openid（与 myFavs 策略一致）
      const { _openid, ...rest } = g;
      return {
        ...rest,
        cover: imgThumb(urlMap[g.cover], THUMB_LIST) || g.cover || (Array.isArray(g.images) && g.images[0]) || ''
      };
    });
    return ok({ list, hasMore: r.data.length === size });
  },

  async myOrders({ role = 'buyer', page = 1, pageSize = 20, status } = {}, openid) {
    const { p, size } = clampPage(page, pageSize);
    const where = role === 'buyer' ? { buyerId: openid } : { sellerId: openid };
    if (status) where.status = status;
    // orders 集合可能在全新环境尚不存在 → 查询抛 -502005，降级为空列表（不 500）
    let r = { data: [] };
    try {
      r = await db.collection(COL_ORDER)
        .where(where).orderBy('createdAt', 'desc')
        .skip((p - 1) * size).limit(size).get();
    } catch (e) { r = { data: [] }; }
    return ok({ list: r.data, hasMore: r.data.length === size });
  },

  async report({ targetType, targetId, reason, desc, images = [] }, openid) {
    if (!targetType || !targetId) return fail('参数不全');
    if (!['goods', 'user'].includes(targetType)) return fail('举报类型不合法');
    const me = await getMyUser(openid);
    if (!me) return fail('用户不存在', 404);
    if (bannedErr(me)) return fail(bannedErr(me), 403);
    // 业务规则兜底：只能举报他人，不能自举报（前端已隐藏入口，这里拦截绕过前端的请求）
    if (targetType === 'goods') {
      const g = await db.collection(COL_GOODS).doc(targetId).get().catch(() => null);
      if (g && g.data && g.data._openid === openid) return fail('不能举报自己发布的商品');
    } else if (targetType === 'user') {
      if (targetId === openid) return fail('不能举报自己');
    }
    const reasonErr = checkText(reason);
    if (reasonErr) return fail(reasonErr);
    const descErr = checkText(desc);
    if (descErr) return fail(descErr);
    // 内容安全检测（官方 UGC 强制要求；接口未开通时优雅降级放行）
    try {
      const t = await cloud.callFunction({ name: 'seccheck', data: { action: 'text', content: ((reason || '') + '\n' + (desc || '')) } });
      if (t && t.result && t.result.data && t.result.data.risky) return fail('举报内容包含违规信息');
    } catch (e) { console.error('seccheck (report) fail', e); }
    // 入参长度与数量上限，防止超大数据写库
    if (reason && String(reason).length > MAX_REASON_LEN) return fail(`举报原因不能超过 ${MAX_REASON_LEN} 字`);
    if (desc && String(desc).length > MAX_DESC_LEN) return fail(`举报描述不能超过 ${MAX_DESC_LEN} 字`);
    if (!Array.isArray(images)) return fail('凭证图片格式不正确');
    if (images.length > MAX_IMAGES) return fail(`最多上传 ${MAX_IMAGES} 张凭证图`);
    const safeImages = images.filter(f => typeof f === 'string' && f.startsWith('cloud://')).slice(0, MAX_IMAGES);
    // reports 集合在举报功能上线前不存在 → 首条举报会因 add 不自动建集合而 500；
    // 走 ensureAdd：捕获 -502005 后 createCollection 再重试
    await ensureAdd(COL_REPORT, {
      _openid: openid,
      reporterNick: me.nickName,
      targetType, targetId, reason, desc, images: safeImages,
      status: 'pending', createdAt: Date.now()
    });
    return ok({ submitted: true });
  },

  async review({ orderId, score, tags = [], content = '' }, openid) {
    const contentErr = checkText(content);
    if (contentErr) return fail(contentErr);
    // 内容安全检测（官方 UGC 强制要求；接口未开通时优雅降级放行）
    try {
      const t = await cloud.callFunction({ name: 'seccheck', data: { action: 'text', content } });
      if (t && t.result && t.result.data && t.result.data.risky) return fail('评价内容包含违规信息');
    } catch (e) { console.error('seccheck (review) fail', e); }
    // 评分必须是 1~5 整数：此前未校验，传 0 会走「差评 -3」分支，可被用来恶意扣信用分
    const scoreNum = Number(score);
    if (!Number.isInteger(scoreNum) || scoreNum < 1 || scoreNum > 5) {
      return fail('评分必须是 1~5 的整数');
    }
    if (!Array.isArray(tags)) return fail('标签格式不正确');
    if (tags.length > MAX_TAGS) return fail(`最多选择 ${MAX_TAGS} 个标签`);
    if (content && String(content).length > MAX_CONTENT_LEN) {
      return fail(`评价内容不能超过 ${MAX_CONTENT_LEN} 字`);
    }
    const safeTags = tags.filter(t => typeof t === 'string' && t.trim())
      .map(t => String(t).trim().slice(0, 10)).slice(0, MAX_TAGS);

    const me = await getMyUser(openid);
    if (bannedErr(me)) return fail(bannedErr(me), 403);
    const r = await db.collection(COL_ORDER).doc(orderId).get();
    if (!r.data) return fail('订单不存在', 404);
    const o = r.data;
    if (o.status !== 'completed') return fail('订单未完成');
    if (o.buyerId !== openid && o.sellerId !== openid) return fail('无权评价');
    if (o.buyerId === o.sellerId) return fail('订单异常，无法评价', 500);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const reviewsToday = await db.collection(COL_REVIEW)
      .where({ _openid: openid, createdAt: _.gte(startOfDay.getTime()) })
      .count().catch(() => ({ total: 0 }));
    if ((reviewsToday.total || 0) >= 5) return fail('今日评价次数已达上限（5 次），请明天再试');
    if (o.buyerReview && o.buyerId === openid) return fail('已评价');
    if (o.sellerReview && o.sellerId === openid) return fail('已评价');
    const updateKey = o.buyerId === openid ? 'buyerReview' : 'sellerReview';
    const reviewDoc = { score: scoreNum, tags: safeTags, content, createdAt: Date.now() };
    await db.collection(COL_ORDER).doc(orderId).update({
      data: { [updateKey]: reviewDoc }
    });
    // reviews 集合在首次评价前不存在 → add 不自动建集合会 500；
    // 走 ensureAdd 自愈（捕获 -502005 → createCollection → 重试）
    await ensureAdd(COL_REVIEW, {
      _openid: openid, orderId, role: updateKey === 'buyerReview' ? 'buyer' : 'seller', score: scoreNum, createdAt: Date.now()
    });
    const other = o.buyerId === openid ? o.sellerId : o.buyerId;
    const otherRes = await db.collection(COL_USER).where({ _openid: other }).limit(1).get();
    if (otherRes.data && otherRes.data.length) {
      const delta = scoreNum >= 4 ? 2 : scoreNum >= 3 ? 0 : -3;
      const cur = otherRes.data[0].credit;
      const next = clampCredit((cur == null ? 100 : cur) + delta);
      await db.collection(COL_USER).doc(otherRes.data[0]._id).update({
        data: { credit: next }
      });
    }
    return ok({ reviewed: true });
  }
};

exports.main = async (event = {}) => {
  const WX = cloud.getWXContext();
  // openid 作为局部变量逐层传参，避免模块级变量在并发请求间互相覆盖
  const openid = WX.OPENID || WX.openid || '';
  if (!openid) return fail('无法识别用户身份', 401);
  const { action } = event;
  const fn = handlers[action];
  if (!fn) return fail('未知 action: ' + action);
  try {
    return await fn(event, openid);
  } catch (e) {
    console.error(action, e);
    return fail(e.message || '服务器错误', 500);
  }
};
