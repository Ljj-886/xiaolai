// cloudfunctions/stress/index.js
// 容量压测函数（临时，测完可删）。只读，不写任何业务数据。
//
// 三种模式：
//   mode='fn'    并发调用 goods 云函数（注意：跨函数调用不带 OPENID，goods 会返回 401，
//                详见 cloudfunctions/goods/index.js:729-730，故此模式仅用于验证通道）
//   mode='db'    绕过身份闸门，直接跑「与 goods.list 完全同形」的隔离查询，测数据库层并发
//   mode='count' 返回各集合真实文档数（当前数据承载量）
//
// 用法：wx.cloud.callFunction({ name:'stress', data:{ mode, concurrency, rounds, skip, school } })
// 注意：本函数超时受云函数配置约束（默认 3s），因此每轮别开太大并发。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function summarize(samples) {
  const lat = samples.map(s => s.ms).sort((a, b) => a - b);
  const ok = samples.filter(s => s.ok).length;
  const failed = samples.filter(s => !s.ok);
  return {
    total: samples.length,
    ok,
    err: failed.length,
    errRate: samples.length ? +(failed.length / samples.length).toFixed(4) : 0,
    minMs: lat[0] || 0,
    p50Ms: pct(lat, 0.5),
    p95Ms: pct(lat, 0.95),
    maxMs: lat[lat.length - 1] || 0,
    errSamples: failed.slice(0, 3).map(s => ({ ms: s.ms, err: s.err }))
  };
}

/** 与 goods.list 同形的隔离查询：status=onSale + 顶层 _.or(campus 隔离) + 排序 + skip/limit */
function buildIsolationQuery(school, skip, pageSize) {
  const base = { status: 'onSale' };
  const campusOr = _.or([
    { campus: school },
    { campus: _.in(['', null]) },
    { campus: _.exists(false) }
  ]);
  return db.collection('goods')
    .where(_.and([base, campusOr]))
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize);
}

exports.main = async (event = {}) => {
  const mode = String(event.mode || 'db');
  const startedAt = Date.now();

  // ---------- 模式：count（当前数据承载量） ----------
  if (mode === 'count') {
    const names = event.collections || ['goods', 'users', 'orders', 'conversations', 'messages', 'favorites', 'reports', 'reviews'];
    const out = {};
    for (const n of names) {
      const t0 = Date.now();
      try {
        const r = await db.collection(n).count();
        out[n] = { total: r.total, ms: Date.now() - t0 };
      } catch (e) {
        out[n] = { err: String((e && (e.errMsg || e.message)) || e).slice(0, 120), ms: Date.now() - t0 };
      }
    }
    return { mode, counts: out, wallMs: Date.now() - startedAt };
  }

  const concurrency = Math.max(1, Math.min(Number(event.concurrency) || 10, 100));
  const rounds = Math.max(1, Math.min(Number(event.rounds) || 1, 10));
  const pageSize = Math.max(1, Math.min(Number(event.pageSize) || 20, 50));
  const skip = Math.max(0, Number(event.skip) || 0);
  const school = String(event.school || '');
  const samples = [];
  const batchMs = [];

  // ---------- 模式：db（直压数据库层） ----------
  if (mode === 'db') {
    const oneQuery = async () => {
      const t0 = Date.now();
      try {
        const r = await buildIsolationQuery(school, skip, pageSize).get();
        return { ok: true, ms: Date.now() - t0, n: (r.data || []).length };
      } catch (e) {
        return { ok: false, ms: Date.now() - t0, err: String((e && (e.errMsg || e.message)) || e).slice(0, 160) };
      }
    };
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      const batch = await Promise.all(Array.from({ length: concurrency }, () => oneQuery()));
      batchMs.push(Date.now() - t0);
      for (const s of batch) samples.push(s);
    }
    return Object.assign({
      mode, school, skip, pageSize, concurrency, rounds,
      rowsReturned: samples.filter(s => s.ok).map(s => s.n).sort((a, b) => a - b)[Math.floor(samples.length / 2)] || 0,
      avgBatchMs: batchMs.length ? Math.round(batchMs.reduce((a, b) => a + b, 0) / batchMs.length) : 0,
      batchMs, wallMs: Date.now() - startedAt
    }, summarize(samples));
  }

  // ---------- 模式：fn（并发调用 goods 云函数，受 OPENID 限制） ----------
  const oneCall = async () => {
    const t0 = Date.now();
    try {
      const r = await cloud.callFunction({
        name: String(event.target || 'goods'),
        data: Object.assign({ action: 'list', page: 1, pageSize }, event.payload || {})
      });
      const res = (r && r.result) || {};
      const okFlag = res.code === undefined ? true : res.code === 0;
      return { ok: okFlag, ms: Date.now() - t0, err: okFlag ? '' : String(JSON.stringify(res)).slice(0, 160) };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, err: String((e && (e.errMsg || e.message)) || e).slice(0, 160) };
    }
  };
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now();
    const batch = await Promise.all(Array.from({ length: concurrency }, () => oneCall()));
    batchMs.push(Date.now() - t0);
    for (const s of batch) samples.push(s);
  }
  return Object.assign({
    mode: 'fn', target: event.target || 'goods', concurrency, rounds,
    avgBatchMs: batchMs.length ? Math.round(batchMs.reduce((a, b) => a + b, 0) / batchMs.length) : 0,
    batchMs, wallMs: Date.now() - startedAt
  }, summarize(samples));
};
