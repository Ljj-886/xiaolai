// cloudfunctions/order/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COL_ORDER = 'orders';
const COL_GOODS = 'goods';
const COL_USER = 'users';

const ok = d => ({ code: 0, data: d });
const fail = (msg, code = 1) => ({ code, msg });

/**
 * 写入自愈：云开发 add 到「不存在的集合」会抛 -502005，不会自动建集合。
 * 捕获 -502005 后先 createCollection 再重试，避免空库/老库首单直接 500。
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

const PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 50;
const MAX_TEXT_LEN = 50;
const MAX_MESSAGE_LEN = 200;

// 超时巡检的进程内节流（单个云函数实例内有效）。
// 客户端节流可被绕过，服务端必须自保：60s 内重复调用直接返回上次结果。
const TIMEOUT_SCAN_GAP = 60 * 1000;
let _lastTimeoutScan = null;

const clampPage = (page, pageSize, def = 20) => ({
  p: Math.max(1, Number(page) || 1),
  size: Math.max(1, Math.min(MAX_PAGE_SIZE, Number(pageSize) || def))
});

/**
 * 给云存储临时 URL 追加 COS 图片处理参数（数据万象 imageMogr2），让渲染层直接拿小图。
 * 实测：一张 2560x1440 / 4286.7KB 的 PNG，加 `&imageMogr2/thumbnail/750x/format/jpg/quality/80`
 * 后只剩 ~26KB。既加快订单列表加载，也避免渲染层因图片过大报「Failed to load image」。
 * 【务必用 `&` 追加】临时 URL 形如 `...?sign=xxx&t=xxx`，覆盖查询串会导致签名失效 403。
 */
function imgThumb(url, width = 750, quality = 80) {
  if (typeof url !== 'string' || url.indexOf('http') !== 0) return url;
  if (url.indexOf('imageMogr2') >= 0) return url;
  if (url.indexOf('tcb.qcloud.la') < 0 && url.indexOf('myqcloud.com') < 0) return url;
  return url + '&imageMogr2/thumbnail/' + width + 'x/format/jpg/quality/' + quality;
}
const THUMB_LIST = 750;

/** 把订单里的 goodsSnapshot.cloud:// 图片转成 https 临时 URL（防止前端 <image> 误解析为相对路径） */
async function decorateSnapshot(orders) {
  if (!orders || !orders.length) return orders;
  const fileIds = [];
  for (const o of orders) {
    const snap = o.goodsSnapshot || {};
    if (snap.cover && snap.cover.startsWith('cloud://')) fileIds.push(snap.cover);
    if (Array.isArray(snap.images)) snap.images.forEach(f => f && f.startsWith && f.startsWith('cloud://') && fileIds.push(f));
  }
  const uniq = [...new Set(fileIds)];
  if (!uniq.length) return orders;
  let urlMap = {};
  try {
    const tr = await cloud.getTempFileURL({ fileList: uniq });
    tr.fileList.forEach(it => { if (it.tempFileURL) urlMap[it.fileID] = it.tempFileURL; });
  } catch (e) { console.error('decorateSnapshot getTempFileURL fail', e); }
  return orders.map(o => {
    const snap = o.goodsSnapshot || {};
    // 兜底：cover 为空时尝试用 images[0]，否则至少给个占位
    const rawCover = snap.cover || (Array.isArray(snap.images) && snap.images[0]) || '';
    const cover = imgThumb(urlMap[rawCover], THUMB_LIST) || rawCover;
    const images = Array.isArray(snap.images) ? snap.images.map(f => imgThumb(urlMap[f], THUMB_LIST) || f) : snap.images;
    return { ...o, goodsSnapshot: { ...snap, cover, images } };
  });
}

function genOrderNo() {
  const d = new Date();
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const s = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return s + Math.floor(Math.random() * 9000 + 1000);
}

/**
 * 释放商品回「在售」。
 * ⚠️ 必须带 `status:'reserved'` 条件，不能无条件写 onSale ——
 * 否则会把「订单等待期间已被管理员下架/禁售(off/banned)」的商品复活上架。
 */
async function releaseGoods(goodsId) {
  if (!goodsId) return;
  try {
    await db.collection(COL_GOODS)
      .where({ _id: goodsId, status: 'reserved' })
      .update({ data: { status: 'onSale', updatedAt: Date.now() } });
  } catch (e) { /* 商品已删除则跳过 */ }
}

const handlers = {
  async create({ goodsId, meetingTime, meetingPlace, message }, openid) {
    if (!goodsId) return fail('缺少 goodsId');
    if (!meetingTime || !String(meetingTime).trim()) return fail('请选择自提时间');
    if (!meetingPlace || !String(meetingPlace).trim()) return fail('请选择自提地点');
    if (String(meetingTime).length > MAX_TEXT_LEN) return fail('自提时间过长');
    if (String(meetingPlace).length > MAX_TEXT_LEN) return fail('自提地点过长');
    if (message && String(message).length > MAX_MESSAGE_LEN) return fail(`留言不能超过 ${MAX_MESSAGE_LEN} 字`);
    const gRes = await db.collection(COL_GOODS).doc(goodsId).get();
    if (!gRes.data) return fail('商品不存在', 404);
    const goods = gRes.data;
    if (goods._openid === openid) return fail('不能购买自己的商品');
    if (goods.status !== 'onSale') return fail('商品已不可购买');
    // 多校隔离：仅限同校交易（买家未选学校 / 跨校都拒绝，避免异地跑单）；封禁用户不可下单
    const meRes = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
    const me = meRes.data && meRes.data[0];
    if (me && me.status === 'banned') return fail('账号已被封禁，无法下单', 403);
    const mySchool = me && me.school;
    if (!mySchool) return fail('请先选择学校后再下单');
    if (goods.campus && goods.campus !== mySchool) return fail('该商品仅限同校同学下单');

    const now = Date.now();
    // ⚠️ 原子抢占商品：必须「条件更新 + 校验 updated 数」。
    // 不能沿用「doc().get() 校验状态 → doc().update() 无条件写」——
    // 两个买家并发下单时会同时读到 onSale、各自建单，同一商品出现多个有效订单（超卖），
    // 且原写法用 .catch(()=>{}) 吞掉了写入失败，商品可能仍停在 onSale 被反复下单。
    const claim = await db.collection(COL_GOODS)
      .where({ _id: goodsId, status: 'onSale' })
      .update({ data: { status: 'reserved', updatedAt: now } });
    if (!(claim.stats && claim.stats.updated === 1)) {
      return fail('手慢了，商品已被抢先下单或已下架', 409);
    }
    const doc = {
      orderNo: genOrderNo(),
      goodsId,
      goodsSnapshot: {
        title: goods.title, cover: goods.cover || (goods.images && goods.images[0]) || '',
        price: goods.price, originalPrice: goods.originalPrice || null,
        category: goods.category || '', condition: goods.condition || 'normal',
        desc: goods.desc || '', images: goods.images || []
      },
      buyerId: openid,
      sellerId: goods._openid,
      price: goods.price,
      status: 'pending',
      meetingTime: meetingTime || '',
      meetingPlace: meetingPlace || '',
      message: message || '',
      campus: goods.campus || '',
      createdAt: now, updatedAt: now
    };
    let r;
    try {
      r = await ensureAdd(COL_ORDER, doc);
    } catch (e) {
      // 建单失败 → 把商品放回 onSale，否则会永久卡在 reserved（谁都买不了，卖家也下不了架）
      await db.collection(COL_GOODS).doc(goodsId)
        .update({ data: { status: 'onSale', updatedAt: Date.now() } }).catch(() => {});
      throw e;
    }
    return ok({ _id: r._id, orderNo: doc.orderNo });
  },

  /** 卖家确认/拒绝（pending → meeting / cancelled） */
  async sellerConfirm({ orderId, accept, reason }, openid) {
    const r = await db.collection(COL_ORDER).doc(orderId).get();
    if (!r.data) return fail('订单不存在', 404);
    const o = r.data;
    if (o.sellerId !== openid) return fail('无权操作', 403);
    // 条件更新防并发（买家可能同时取消 / 超时巡检可能同时介入）
    if (accept) {
      const upd = await db.collection(COL_ORDER)
        .where({ _id: orderId, status: 'pending' })
        .update({ data: { status: 'meeting', sellerConfirmAt: Date.now(), updatedAt: Date.now() } });
      if (!(upd.stats && upd.stats.updated === 1)) return fail('订单状态已变更，请刷新后重试', 409);
    } else {
      const upd = await db.collection(COL_ORDER)
        .where({ _id: orderId, status: 'pending' })
        .update({ data: { status: 'cancelled', cancelReason: reason || '卖家拒绝', updatedAt: Date.now() } });
      if (!(upd.stats && upd.stats.updated === 1)) return fail('订单状态已变更，请刷新后重试', 409);
      // 商品恢复在售
      await releaseGoods(o.goodsId);
    }
    return ok({ ok: true });
  },

  /** 买家取消（pending / meeting 状态） */
  async buyerCancel({ orderId, reason }, openid) {
    const r = await db.collection(COL_ORDER).doc(orderId).get();
    if (!r.data) return fail('订单不存在', 404);
    const o = r.data;
    if (o.buyerId !== openid) return fail('无权操作', 403);
    const upd = await db.collection(COL_ORDER)
      .where({ _id: orderId, status: _.in(['pending', 'meeting']) })
      .update({ data: { status: 'cancelled', cancelReason: reason || '买家取消', cancelledBy: 'buyer', updatedAt: Date.now() } });
    if (!(upd.stats && upd.stats.updated === 1)) return fail('订单状态已变更，请刷新后重试', 409);
    await releaseGoods(o.goodsId);
    return ok({ ok: true });
  },

  /**
   * 卖家主动取消（meeting 状态）：
   * - 防买家反悔/约定变更/卖家临时缺货
   * - 商品恢复 onSale；订单标记 cancelledBy=seller
   */
  async sellerCancel({ orderId, reason }, openid) {
    const r = await db.collection(COL_ORDER).doc(orderId).get();
    if (!r.data) return fail('订单不存在', 404);
    const o = r.data;
    if (o.sellerId !== openid) return fail('无权操作', 403);
    const upd = await db.collection(COL_ORDER)
      .where({ _id: orderId, status: 'meeting' })
      .update({ data: { status: 'cancelled', cancelReason: reason || '卖家取消', cancelledBy: 'seller', updatedAt: Date.now() } });
    if (!(upd.stats && upd.stats.updated === 1)) {
      return fail('仅已确认的订单可取消，pending 状态请用「拒绝」', 409);
    }
    // 释放商品到在售
    await releaseGoods(o.goodsId);
    return ok({ ok: true });
  },

  /** 标记完成（双方任一方可点；校园二手实际大多现场点确认即可） */
  async complete({ orderId }, openid) {
    const r = await db.collection(COL_ORDER).doc(orderId).get();
    if (!r.data) return fail('订单不存在', 404);
    const o = r.data;
    if (o.buyerId !== openid && o.sellerId !== openid) return fail('无权操作', 403);
    // ⚠️ 幂等：条件更新 + 校验 updated 数。
    // 买卖双方可能同时点「完成」，若沿用「get 校验 → 无条件 update」，
    // 两人都会通过校验，导致 soldCount / boughtCount 各 +1 两次（统计虚高）。
    const upd = await db.collection(COL_ORDER)
      .where({ _id: orderId, status: _.in(['meeting', 'paid']) })
      .update({
        data: { status: 'completed', completedAt: Date.now(), completedBy: openid, updatedAt: Date.now() }
      });
    if (!(upd.stats && upd.stats.updated === 1)) {
      return fail('订单已完成或状态已变更，请刷新后查看', 409);
    }
    // ↓ 以下只在「抢到完成态」的那一次执行，因此天然幂等
    // 商品转 sold
    await db.collection(COL_GOODS).doc(o.goodsId).update({ data: { status: 'sold', updatedAt: Date.now() } }).catch(() => {});
    // 更新双方计数
    const bs = await db.collection(COL_USER).where({ _openid: o.buyerId }).limit(1).get();
    if (bs.data && bs.data.length) {
      await db.collection(COL_USER).doc(bs.data[0]._id).update({ data: { boughtCount: _.inc(1) } });
    }
    const ss = await db.collection(COL_USER).where({ _openid: o.sellerId }).limit(1).get();
    if (ss.data && ss.data.length) {
      await db.collection(COL_USER).doc(ss.data[0]._id).update({ data: { soldCount: _.inc(1) } });
    }
    return ok({ ok: true });
  },

  /** 详情 */
  async detail({ orderId }, openid) {
    const r = await db.collection(COL_ORDER).doc(orderId).get();
    if (!r.data) return fail('订单不存在', 404);
    const o = r.data;
    if (o.buyerId !== openid && o.sellerId !== openid) return fail('无权查看', 403);
    // 双方信息
    const ids = [o.buyerId, o.sellerId];
    const u = await db.collection(COL_USER).where({ _openid: _.in(ids) })
      .field({ _openid: true, nickName: true, avatarUrl: true, verified: true, credit: true, school: true })
      .get();
    const map = {};
    u.data.forEach(x => map[x._openid] = x);
    const [decorated] = await decorateSnapshot([o]);
    return ok({ ...decorated, buyerInfo: map[o.buyerId] || {}, sellerInfo: map[o.sellerId] || {} });
  },

  /** 列表（带商品信息） */
  async list({ role = 'buyer', status, page = 1, pageSize = 20 } = {}, openid) {
    const { p, size } = clampPage(page, pageSize);
    const where = role === 'buyer' ? { buyerId: openid } : { sellerId: openid };
    if (status) where.status = status;
    const r = await db.collection(COL_ORDER)
      .where(where).orderBy('createdAt', 'desc')
      .skip((p - 1) * size).limit(size).get();
    const list = await decorateSnapshot(r.data);
    return ok({ list, hasMore: r.data.length === size });
  },

  /**
   * 超时巡检：pending 超过 24 小时的订单自动取消并恢复商品在售。
   * 任何登录用户触发都行（客户端由首页 onShow 节流调用，约 10 分钟一次）。
   *
   * 防滥用：客户端节流不可信（可绕过），服务端必须自保 ——
   *   ① 进程内时间锁（同一实例 60s 内只真正扫一次，重复调用直接返回缓存结果）；
   *   ② 最多扫 50 单，且**并行**处理，避免循环内串行 await 拖长执行时间。
   */
  async checkTimeout() {
    const now = Date.now();
    // ① 进程内节流：60s 内的重复调用直接返回上次结果，不做任何 DB 操作
    if (_lastTimeoutScan && now - _lastTimeoutScan.at < TIMEOUT_SCAN_GAP) {
      return ok({ ..._lastTimeoutScan.result, throttled: true });
    }
    const deadline = now - PENDING_TIMEOUT_MS;
    const r = await db.collection(COL_ORDER)
      .where({ status: 'pending', createdAt: _.lt(deadline) })
      .limit(50).get();
    // ② 并行处理（每单最多 2 次 DB 往返：条件更新 + 商品释放检查）
    const results = await Promise.all(r.data.map(async o => {
      try {
        // 条件更新防并发：只把仍是 pending 的置为 cancelled
        const res = await db.collection(COL_ORDER)
          .where({ _id: o._id, status: 'pending' })
          .update({
            data: {
              status: 'cancelled',
              cancelReason: '超时 24 小时未确认，系统自动取消',
              autoCancelled: true,
              updatedAt: Date.now()
            }
          });
        if (!(res.stats && res.stats.updated)) return 0;
        // 释放商品：仅当商品仍因本单处于 reserved 时恢复在售
        try {
          const g = await db.collection(COL_GOODS).doc(o.goodsId).get();
          if (g.data && g.data.status === 'reserved') {
            await db.collection(COL_GOODS).doc(o.goodsId)
              .update({ data: { status: 'onSale', updatedAt: Date.now() } });
          }
        } catch (e) { /* 商品已删除则跳过 */ }
        return 1;
      } catch (e) { return 0; }
    }));
    const cancelled = results.reduce((s, x) => s + x, 0);
    const result = { cancelled, checked: r.data.length };
    _lastTimeoutScan = { at: now, result };
    return ok(result);
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
