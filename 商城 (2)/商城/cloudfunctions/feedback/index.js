// cloudfunctions/feedback/index.js
// 通用「意见反馈 / 违规举报」收集：提交入库 + 管理员查看与处理。
// 个人主体无法接入微信客服（open-type=contact / wx.openCustomerServiceChat 均需企业主体），
// 故用内置表单替代，满足微信审核对「举报入口 + 响应承诺」的硬性要求。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COL_USER = 'users';
const COL_FEEDBACK = 'feedback';

// 与 user/admin 云函数保持一致的管理员白名单（本仓库各函数独立维护，新增管理员需同步修改）
const ADMIN_OPENIDS = ['o5NAjxrVqSopwCl-rnh0cwjv1auE'];

const MAX_PAGE_SIZE = 50;
const MAX_CONTENT_LEN = 500;
const MAX_CONTACT_LEN = 50;
const MAX_IMAGES = 3;
const MAX_PER_DAY = 5;

const FEEDBACK_KINDS = ['suggest', 'bug', 'report', 'other'];

function ok(data) { return { code: 0, data }; }
function fail(msg, code = 1) { return { code, msg }; }

/**
 * 写入自愈：云开发 add 到「不存在的集合」会抛 -502005，不会自动建集合。
 * 捕获 -502005 后先 createCollection 再重试，避免空库/老库首条反馈直接 500。
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

function clampPage(page, pageSize, def = 20) {
  return {
    p: Math.max(1, Number(page) || 1),
    size: Math.max(1, Math.min(MAX_PAGE_SIZE, Number(pageSize) || def))
  };
}

async function getMyUser(openid) {
  const r = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
  return r.data && r.data[0];
}

async function isAdmin(openid) {
  if (ADMIN_OPENIDS.indexOf(openid) !== -1) return true;
  const me = await getMyUser(openid);
  return !!(me && me.isAdmin);
}

async function submit({ kind, content, contact, images = [] } = {}, openid) {
  if (!openid) return fail('请先登录', 401);
  const me = await getMyUser(openid);
  if (!me) return fail('用户不存在', 404);
  if (me.status === 'banned') return fail('账号已被封禁，暂无法提交', 403);
  if (!content || typeof content !== 'string' || !content.trim()) return fail('请填写反馈内容');
  content = content.trim().slice(0, MAX_CONTENT_LEN);
  if (!FEEDBACK_KINDS.includes(kind)) kind = 'other';

  // 内容安全检测（官方 UGC 强制；接口未开通时优雅降级放行）
  try {
    const t = await cloud.callFunction({ name: 'seccheck', data: { action: 'text', content } });
    if (t && t.result && t.result.data && t.result.data.risky) return fail('反馈内容包含违规信息');
  } catch (e) { console.error('seccheck (feedback) fail', e); }

  // 限频：每用户每天最多 5 条，防刷
  try {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const cnt = await db.collection(COL_FEEDBACK).where({ _openid: openid, createdAt: _.gt(dayAgo) }).count();
    if (cnt.total >= MAX_PER_DAY) return fail('今日反馈次数已达上限，请明天再试');
  } catch (e) { console.error('feedback rate-limit count fail', e); }

  const safeImages = Array.isArray(images)
    ? images.filter(f => typeof f === 'string' && f.startsWith('cloud://')).slice(0, MAX_IMAGES)
    : [];
  const safeContact = (contact && typeof contact === 'string') ? contact.trim().slice(0, MAX_CONTACT_LEN) : '';

  await ensureAdd(COL_FEEDBACK, {
    _openid: openid,
    nickName: me.nickName || '',
    school: me.school || '',
    campus: me.school || '', // 多校隔离：反馈按提交者所在学校归属，便于分校区处理
    kind,
    content,
    contact: safeContact,
    images: safeImages,
    status: 'pending',
    createdAt: Date.now()
  });
  return ok({ submitted: true });
}

async function list({ status, page = 1, pageSize = 20 } = {}, openid) {
  if (!await isAdmin(openid)) return fail('无权限', 403);
  const { p, size } = clampPage(page, pageSize);
  const where = {};
  if (status) where.status = status;
  const r = await db.collection(COL_FEEDBACK)
    .where(where).orderBy('createdAt', 'desc')
    .skip((p - 1) * size).limit(size).get();
  const total = await db.collection(COL_FEEDBACK).where(where).count();
  // 兜底默认字段：防止前端渲染时访问 undefined.xxx 抛 TypeError
  const list = r.data.map(x => ({
    images: [], nickName: '', school: '', contact: '', content: '', kind: 'other',
    ...x,
    images: Array.isArray(x.images) ? x.images : []
  }));
  return ok({ list, hasMore: r.data.length === size, total: total.total });
}

async function handle({ id, status, note = '' } = {}, openid) {
  if (!await isAdmin(openid)) return fail('无权限', 403);
  if (!id) return fail('参数缺失');
  // 允许：已处理resolved / 驳回rejected / 重新打开pending（二次处理）
  const allow = ['resolved', 'rejected', 'pending'];
  if (!allow.includes(status)) status = 'resolved';
  const data = { status, handlerNote: String(note || '').slice(0, 200), handledAt: Date.now() };
  // 重新打开（二次处理）时清空旧处理时间，便于前端识别为待处理
  if (status === 'pending') { data.handledAt = _.remove(); }
  await db.collection(COL_FEEDBACK).doc(id).update({ data });
  return ok({ done: true });
}

exports.main = async (event = {}, context) => {
  const { OPENID } = cloud.getWXContext();
  const openid = OPENID || '';
  const action = event.action;
  try {
    if (action === 'submit') return await submit(event, openid);
    if (action === 'list') return await list(event, openid);
    if (action === 'handle') return await handle(event, openid);
    return fail('未知操作');
  } catch (e) {
    console.error('feedback error', e);
    return fail('服务异常，请稍后再试');
  }
};
