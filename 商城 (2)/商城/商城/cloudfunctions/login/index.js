// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL_USER = 'users';

/**
 * 写入自愈：云开发 add 到「不存在的集合」会抛 -502005，不会自动建集合。
 * 全新环境首登录时 users 集合尚不存在，必须用 ensureAdd 建集合后再写入，否则首登录直接 500。
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

/**
 * 「我的资料」字段白名单 —— login 与 user.me 共用同一策略（见 cloudfunctions/user 的 projectSelf）。
 *
 * 背景：原先直接下发整条 users 文档，会带出 `verifyApply.evidence`（学生证/学信网**证件原图**）
 * 及一批内部流转字段。保留字段均已核对前端读取位置。
 * 注意 `_openid` / `studentId` / `shareCode` 等当前有 UI 或逻辑依赖，暂不可删。
 */
function projectSelf(u) {
  if (!u) return null;
  const out = {
    _id: u._id,
    _openid: u._openid,
    nickName: u.nickName,
    avatarUrl: u.avatarUrl,
    school: u.school,
    studentId: u.studentId,
    realName: u.realName,
    gender: u.gender,
    education: u.education,
    verified: u.verified,
    credit: u.credit,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    onSaleCount: u.onSaleCount,
    soldCount: u.soldCount,
    status: u.status
  };
  const va = u.verifyApply;
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

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || wxContext.openid;
  if (!openid) return { code: -1, msg: '获取 openid 失败' };

  try {
    // 全新环境 users 集合尚不存在 → 查询会抛 -502005。不能让它被外层 catch 吞掉返回"登录失败"，
    // 否则用户永远无法被创建（死锁）。这里把"集合不存在"当作"无此用户"，走下方 ensureAdd 创建分支。
    let exist;
    try {
      exist = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
    } catch (e) {
      exist = { data: [] };
    }
    let userInfo = null;

    if (exist.data && exist.data.length) {
      userInfo = exist.data[0];
    // 每日活跃 +1
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const last = userInfo.lastActiveAt ? new Date(userInfo.lastActiveAt) : null;
    if (!last || last < today) {
      await db.collection(COL_USER).doc(userInfo._id).update({
        data: { lastActiveAt: Date.now() }
      });
      userInfo.lastActiveAt = Date.now();
    }
  } else {
    const now = Date.now();
    const doc = {
      _openid: openid,
      nickName: '同学' + String(Math.floor(Math.random() * 9000) + 1000),
      avatarUrl: '',
      school: '',
      studentId: '',
      verified: false,
      credit: 100,
      publishedCount: 0,
      soldCount: 0,
      boughtCount: 0,
      status: 'normal',
      isAdmin: false,
      lastActiveAt: now,
      createdAt: now
    };
    const res = await ensureAdd(COL_USER, doc);
    userInfo = { ...doc, _id: res._id };
  }

    // 头像兜底 + cloud:// → https
    //   wxfile:// / http:// → 失效的微信临时路径（chooseAvatar 返回的就是 wxfile://tmp/...），清空让前端走默认头像
    //   cloud:// → 换 https（前端 <image> 渲染 cloud:// 可能裂图）
    //   https:// → 永久外链，原样返回
    if (userInfo && userInfo.avatarUrl && (userInfo.avatarUrl.startsWith('wxfile://') || userInfo.avatarUrl.startsWith('http://'))) {
      userInfo.avatarUrl = '';
    } else if (userInfo && userInfo.avatarUrl && userInfo.avatarUrl.startsWith('cloud://')) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: [userInfo.avatarUrl] });
        if (tr.fileList && tr.fileList[0] && tr.fileList[0].tempFileURL) {
          userInfo.avatarUrl = tr.fileList[0].tempFileURL;
        }
      } catch (e) { console.error('getTempFileURL (login avatar) fail', e); }
    }

    // banned 标记便于前端判断（封禁用户只读，不能发布/下单/发消息）
    // ⚠️ 只返回白名单字段，**不要下发整条用户文档** ——
    //    整条会带出 verifyApply.evidence（学生证/学信网证件原图）等不该给前端的字段。
    return { code: 0, data: { openid, userInfo: projectSelf(userInfo), banned: userInfo.status === 'banned' } };
  } catch (e) {
    console.error('login', e);
    return { code: -1, msg: (e && e.message) || '登录失败' };
  }
};
