// cloudfunctions/chat/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COL_CONV = 'conversations';
const COL_MSG = 'messages';
const COL_USER = 'users';
const COL_GOODS = 'goods';
const SENSITIVE = require('./sensitive-words.js');

const ok = d => ({ code: 0, data: d });
const fail = (msg, code = 1) => ({ code, msg });

/**
 * 写入自愈：云开发 add/set 到「不存在的集合」都会抛 -502005，不会自动建集合。
 * 捕获 -502005 后先 createCollection 再重试，避免空库/老库首写直接 500。
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
async function ensureSet(collection, id, data) {
  // 注意：doc(id).set() 里不能再次出现 _id，否则云开发报 -501007「不能更新_id的值」。
  // 调用方为了方便把 _id 写进了 data，这里统一剥离（重试也走同一份干净数据）。
  const d = Object.assign({}, data);
  delete d._id;
  try { return await db.collection(collection).doc(id).set({ data: d }); }
  catch (e) {
    const msg = (e && e.message) || '';
    const code = e && e.errCode;
    if (code === -502005 || msg.indexOf('not exists') !== -1 || msg.indexOf('ResourceNotFound') !== -1) {
      try { await db.createCollection(collection); } catch (e2) { console.error('createCollection fail', collection, e2 && e2.message); }
      return await db.collection(collection).doc(id).set({ data: d });
    }
    throw e;
  }
}

const MAX_PAGE_SIZE = 50;
const MAX_CONTENT_LEN = 500;
const clampPageSize = n => Math.max(1, Math.min(MAX_PAGE_SIZE, Number(n) || 30));

function convKey(a, b) { return [a, b].sort().join('_'); }

/** 文本敏感词命中检查（图片消息跳过） */
function checkMessageText(type, content) {
  if (type !== 'text') return '';
  if (!content || typeof content !== 'string') return '消息内容不能为空';
  const hit = SENSITIVE.SENSITIVE_WORDS.find(w => content.indexOf(w) !== -1);
  return hit ? `消息含违禁词「${hit}」` : '';
}

/**
 * 读取会话并校验调用者是会话成员。
 * convId 形如 [openidA, openidB].sort().join('_') + '_' + goodsId，
 * 而 openid 在商品/用户信息接口里是公开的 → convId 可被任意构造，
 * 因此每个按 convId 操作的接口都必须先做成员校验，否则等于私聊裸奔。
 * @returns {{err?:object, conv?:object}}
 */
async function getConvAsMember(convId, openid) {
  if (!convId || typeof convId !== 'string') return { err: fail('缺少 convId') };
  const r = await db.collection(COL_CONV).doc(convId).get().catch(() => null);
  if (!r || !r.data) return { err: fail('会话不存在', 404) };
  const parts = Array.isArray(r.data.participants) ? r.data.participants : [];
  if (parts.indexOf(openid) === -1) return { err: fail('无权访问该会话', 403) };
  return { conv: r.data };
}

/** 封禁用户禁止发起会话与发送消息 */
async function assertNotBanned(openid) {
  const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get().catch(() => null);
  const me = u && u.data && u.data[0];
  if (me && me.status === 'banned') return fail('账号已被封禁，无法发送消息', 403);
  return null;
}

/**
 * 给云存储临时 URL 追加 COS 图片处理参数（数据万象 imageMogr2），让渲染层直接拿小图。
 * 实测：一张 2560x1440 / 4286.7KB 的 PNG，加 `&imageMogr2/thumbnail/1080x/format/jpg/quality/80`
 * 后返回 52.2KB JPEG（约 1/82）。聊天里发原图（相机直出常 2~5MB）时尤其明显：
 * 既加快发送后的显示，也避免渲染层因图片过大报「Failed to load image」。
 * 【务必用 `&` 追加】临时 URL 形如 `...?sign=xxx&t=xxx`，覆盖查询串会导致签名失效 403。
 */
function imgThumb(url, width = 750, quality = 80) {
  if (typeof url !== 'string' || url.indexOf('http') !== 0) return url;
  if (url.indexOf('imageMogr2') >= 0) return url;
  if (url.indexOf('tcb.qcloud.la') < 0 && url.indexOf('myqcloud.com') < 0) return url;
  return url + '&imageMogr2/thumbnail/' + width + 'x/format/jpg/quality/' + quality;
}
const THUMB_CHAT = 1280;   // 聊天图片（点击可看大图，1080~1280 足够）
const THUMB_AVATAR = 200;  // 会话列表头像

const handlers = {
  /** 获取/创建会话（按 goodsId + 双方） */
  async ensureConv({ peerOpenid, goodsId }, openid) {
    if (!peerOpenid || !goodsId) return fail('参数不全');
    if (peerOpenid === openid) return fail('不能与自己对话');
    const banErr = await assertNotBanned(openid);
    if (banErr) return banErr;
    // goodsId 决定会话粒度
    const id = convKey(openid, peerOpenid) + '_' + goodsId;
    const exist = await db.collection(COL_CONV).doc(id).get().catch(() => null);
    if (exist && exist.data) return ok({ _id: id });
    const g = await db.collection(COL_GOODS).doc(goodsId).get().catch(() => null);
    if (!g || !g.data) return fail('商品不存在', 404);
    await ensureSet(COL_CONV, id, {
      _id: id,
      participants: [openid, peerOpenid].sort(),
      a: openid < peerOpenid ? openid : peerOpenid,
      b: openid < peerOpenid ? peerOpenid : openid,
      goodsId,
      goodsSnapshot: {
        title: g.data.title, cover: g.data.cover || (g.data.images && g.data.images[0]) || '', price: g.data.price
      },
      lastMessage: '', lastMessageAt: 0,
      unread: { [openid]: 0, [peerOpenid]: 0 },
      createdAt: Date.now(), updatedAt: Date.now()
    });
    return ok({ _id: id });
  },

  /** 发送消息 */
  async send({ convId, peerOpenid, goodsId, type = 'text', content }, openid) {
    const banErr = await assertNotBanned(openid);
    if (banErr) return banErr;
    if (!content) return fail('消息内容不能为空');
    if (typeof content === 'string' && content.length > MAX_CONTENT_LEN) {
      return fail(`消息不能超过 ${MAX_CONTENT_LEN} 字`);
    }
    const textErr = checkMessageText(type, content);
    if (textErr) return fail(textErr);
    // 内容安全检测（官方 UGC 强制要求；接口未开通时优雅降级放行）
    if (type === 'text' && content) {
      try {
        const t = await cloud.callFunction({ name: 'seccheck', data: { action: 'text', content } });
        if (t && t.result && t.result.data && t.result.data.risky) return fail('消息包含违规内容，发送失败');
      } catch (e) { console.error('seccheck (chat) fail', e); }
    }

    let id = convId;
    let conv = null;
    if (id) {
      // 传入 convId 时必须校验成员，否则可向任意会话注入消息
      const got = await getConvAsMember(id, openid);
      if (got.err) return got.err;
      conv = got.conv;
    } else {
      const r = await handlers.ensureConv({ peerOpenid, goodsId }, openid);
      if (r.code !== 0) return r;
      id = r.data._id;
      const got = await db.collection(COL_CONV).doc(id).get().catch(() => null);
      conv = got && got.data;
    }

    const now = Date.now();
    const addRes = await ensureAdd(COL_MSG, { _openid: openid, convId: id, type, content, createdAt: now, read: false });
    // 更新会话
    const updateData = {
      lastMessage: type === 'text' ? content : `[${type === 'image' ? '图片' : type}]`,
      lastMessageAt: now, updatedAt: now
    };
    // 对方未读 +1（只给真正的对端加，避免误给陌生人累加）
    // ⚠️ 必须用服务端原子自增 `_.inc(1)` 写「点路径」字段。
    // 原实现是「读 conv.unread 快照 → 自增 → 整体回写」：两条消息并发时都拿到同一份旧快照，
    // 回写互相覆盖 → 对方未读数少算、红点不准。用点路径 + _.inc 可让服务端串行累加，天然不丢。
    if (conv && Array.isArray(conv.participants)) {
      const other = conv.participants.find(p => p !== openid);
      if (other) {
        updateData['unread.' + other] = _.inc(1);
      }
    }
    await db.collection(COL_CONV).doc(id).update({ data: updateData });
    // 返回真实 _id 与 sentAt：前端乐观上屏后可用真实消息原地替换临时项，无需再拉一次全量列表
    return ok({ convId: id, sentAt: now, _id: addRes && addRes._id });
  },

  /** 会话列表（按 participants 过滤，天然只返回自己的会话；支持分页） */
  async convs({ page = 1, pageSize = 20 } = {}, openid) {
    const size = Math.max(1, Math.min(50, Number(pageSize) || 20));
    const p = Math.max(1, Number(page) || 1);
    const r = await db.collection(COL_CONV)
      .where({ participants: openid })
      .orderBy('lastMessageAt', 'desc')
      .skip((p - 1) * size).limit(size).get();
    if (!r.data.length) return ok({ list: [], hasMore: false });
    const peerIds = r.data.map(c => (c.participants || []).find(p => p !== openid)).filter(Boolean);
    const u = await db.collection(COL_USER).where({ _openid: _.in(peerIds) })
      .field({ _openid: true, nickName: true, avatarUrl: true, verified: true, credit: true, school: true })
      .get();
    const map = {}; u.data.forEach(x => map[x._openid] = x);
    // 对方头像兜底：cloud:// 换 https；wxfile:// / http:// 失效临时路径清空走默认头像
    const avatarIds = u.data.filter(x => x.avatarUrl && x.avatarUrl.startsWith('cloud://')).map(x => x.avatarUrl);
    u.data.forEach(x => { if (x.avatarUrl && (x.avatarUrl.startsWith('wxfile://') || x.avatarUrl.startsWith('http://'))) x.avatarUrl = ''; });
    if (avatarIds.length) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: [...new Set(avatarIds)] });
        const urlMap = {};
        tr.fileList.forEach(it => { if (it.tempFileURL) urlMap[it.fileID] = it.tempFileURL; });
        u.data.forEach(x => { if (x.avatarUrl && urlMap[x.avatarUrl]) x.avatarUrl = imgThumb(urlMap[x.avatarUrl], THUMB_AVATAR); });
      } catch (e) { console.error('getTempFileURL (chat convs) fail', e); }
    }
    const list = r.data.map(c => {
      const peer = (c.participants || []).find(p => p !== openid);
      return {
        ...c,
        peerInfo: map[peer] || {},
        unreadCount: (c.unread && c.unread[openid]) || 0
      };
    });
    return ok({ list, hasMore: r.data.length === size });
  },

  /** 消息历史（支持增量：传 since 只返回 createdAt > since 的新消息） */
  async messages({ convId, page = 1, pageSize = 30, since = 0 }, openid) {
    if (!convId) return fail('缺少 convId');
    // 必须先校验成员，否则可读取任意两人聊天记录
    const got = await getConvAsMember(convId, openid);
    if (got.err) return got.err;
    const size = clampPageSize(pageSize);
    const p = Math.max(1, Number(page) || 1);
    const sinceTs = Number(since) || 0;
    // 增量模式（since>0）：只要比 since 新、最多 size 条（不翻页），用于 5s 轮询续拉；
    // 全量模式（since=0）：按页取最近 size 条，用于首次进入/下拉。
    let q = db.collection(COL_MSG).where(sinceTs ? { convId, createdAt: _.gt(sinceTs) } : { convId });
    q = q.orderBy('createdAt', 'desc');
    if (!sinceTs) q = q.skip((p - 1) * size);
    const r = await q.limit(size).get();
    // 把图片消息的 fileID 转成临时 https URL（客户端 <image> 才能直接渲染）
    const fileIds = [];
    r.data.forEach(m => { if (m.type === 'image' && typeof m.content === 'string' && m.content.startsWith('cloud://')) fileIds.push(m.content); });
    if (fileIds.length) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: [...new Set(fileIds)] });
        const map = {};
        tr.fileList.forEach(it => { if (it.tempFileURL) map[it.fileID] = it.tempFileURL; });
        r.data.forEach(m => { if (m.type === 'image') m.content = imgThumb(map[m.content], THUMB_CHAT) || m.content; });
      } catch (e) { console.error('getTempFileURL fail (chat)', e); }
    }
    // 标记已读：全量拉取时必做；增量拉取时仅当确有新消息才写库
    //（避免每 5s 轮询都产生一次无意义的 DB 写入）
    if (!sinceTs || r.data.length) {
      await db.collection(COL_CONV).doc(convId).update({
        data: { [`unread.${openid}`]: 0 }
      }).catch(() => {});
    }
    return ok({
      list: r.data.reverse(),
      hasMore: r.data.length === size,
      incremental: !!sinceTs,
      // 增量模式下取满 size 条说明"新消息太多，一次没拉完"，前端应改为全量重拉
      truncated: !!sinceTs && r.data.length === size
    });
  },

  /** 清空未读（仅针对当前用户） */
  async clearUnread({ convId }, openid) {
    if (!convId) return fail('缺少 convId');
    // 校验成员，否则可篡改他人会话的未读计数
    const got = await getConvAsMember(convId, openid);
    if (got.err) return got.err;
    await db.collection(COL_CONV).doc(convId).update({
      data: { [`unread.${openid}`]: 0 }
    }).catch(() => {});
    return ok({ ok: true });
  },

  /** 删除一条消息（仅限该会话的成员；任一成员可删，便于清理测试残留/脏数据） */
  async deleteMessage({ msgId }, openid) {
    if (!msgId) return fail('缺少 msgId');
    const m = await db.collection(COL_MSG).doc(msgId).get().catch(() => null);
    if (!m || !m.data) return fail('消息不存在', 404);
    const got = await getConvAsMember(m.data.convId, openid);
    if (got.err) return got.err;
    await db.collection(COL_MSG).doc(msgId).remove().catch(() => {});
    // 若删的是当前会话最后一条消息，顺便回填 lastMessage / lastMessageAt
    const conv = got.conv;
    if (conv && m.data.createdAt && m.data.createdAt === conv.lastMessageAt) {
      try {
        const prev = await db.collection(COL_MSG).where({ convId: m.data.convId })
          .orderBy('createdAt', 'desc').limit(1).get();
        const last = prev.data && prev.data[0];
        await db.collection(COL_CONV).doc(m.data.convId).update({
          data: {
            lastMessage: last ? (last.type === 'text' ? last.content : '[' + (last.type === 'image' ? '图片' : last.type) + ']') : '',
            lastMessageAt: last ? last.createdAt : 0,
            updatedAt: Date.now()
          }
        }).catch(() => {});
      } catch (e) {}
    }
    return ok({ ok: true });
  },

  /** 删除会话（本人必须是成员）+ 级联删除其全部消息 */
  async deleteConversation({ convId }, openid) {
    if (!convId) return fail('缺少 convId');
    // 必须先校验成员，否则可删除任意人的会话（私聊裸奔）
    const got = await getConvAsMember(convId, openid);
    if (got.err) return got.err;
    // 删除会话文档（已不存在则忽略）
    await db.collection(COL_CONV).doc(convId).remove().catch(() => {});
    // 级联删除消息：集合可能不存在 → get 抛 -502005，降级为「无消息可删」
    const BATCH = 100;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await db.collection(COL_MSG).where({ convId }).limit(BATCH).get().catch(() => ({ data: [] }));
      if (!r.data.length) break;
      await Promise.all(r.data.map(m =>
        db.collection(COL_MSG).doc(m._id).remove().catch(() => {})
      ));
      if (r.data.length < BATCH) break;
    }
    return ok({ ok: true });
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
  catch (e) { console.error(event.action, e); return fail(e.message || '服务器错误', 500); }
};
