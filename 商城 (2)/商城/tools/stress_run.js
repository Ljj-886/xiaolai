// tools/stress_run.js
// 校园隔离容量压测驱动。三阶段：
//   P1 客户端真并发：模拟器内并发发起 N 个真实 goods.list（带真实身份，走完整链路）
//   P2 数据承载量：调用 stress(mode=count) 取各集合真实文档数
//   P3 数据库层并发 + 深翻页成本：stress(mode=db) 直压隔离查询
//
// 前置：IDE 已打开本项目，且已执行
//   "D:\weixinkaifa\微信web开发者工具\cli.bat" auto --project "D:\商城" --auto-port 9420
// 用法：node tools/stress_run.js [clientLevels] [dbLevels]
//   例：node tools/stress_run.js 5,10,20,50 10,20,50

const path = require('path');
const fs = require('fs');
const Automator = require('miniprogram-automator');

const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const REPS = 2;
const GUARD_MS = 90000;
// 阶段开关：PHASES=p1,p2,p3 只跑指定阶段（默认全跑）
const PHASES = (process.env.PHASES || 'p1,p2,p3').split(',').map(s => s.trim());
const has = p => PHASES.includes(p);

const CLIENT_LEVELS = (process.argv[2] ? process.argv[2].split(',') : ['5', '10', '20', '50'])
  .map(Number).filter(n => n > 0);
const DB_LEVELS = (process.argv[3] ? process.argv[3].split(',') : ['10', '20', '50'])
  .map(Number).filter(n => n > 0);

const wait = ms => new Promise(r => setTimeout(r, ms));

function guard(promise, tag) {
  return Promise.race([
    promise,
    new Promise(res => setTimeout(() => res({ __guardTimeout: true, tag }), GUARD_MS))
  ]);
}

const evalSafe = (mp, fn, ...args) =>
  guard(
    mp.evaluate(fn, ...args).catch(e => ({ __evalErr: String((e && e.message) || e) })),
    'evaluate'
  );

/** P1: 在模拟器内并发 N 个真实 goods.list */
function clientBatch(mp, n) {
  return evalSafe(mp, d => new Promise(resolve => {
    const t0 = Date.now();
    const tasks = Array.from({ length: d.n }, () => {
      const s = Date.now();
      return wx.cloud.callFunction({ name: 'goods', data: { action: 'list', page: 1, pageSize: 20 } })
        .then(r => ({
          ok: !!(r && r.result && r.result.code === 0),
          ms: Date.now() - s,
          code: r && r.result && r.result.code,
          err: (r && r.result && r.result.code !== 0) ? String(r.result.msg || '').slice(0, 80) : ''
        }))
        .catch(e => ({ ok: false, ms: Date.now() - s, err: String((e && (e.errMsg || e.message)) || e).slice(0, 120) }));
    });
    Promise.all(tasks).then(rs => {
      const lat = rs.map(x => x.ms).sort((a, b) => a - b);
      resolve({
        n: d.n,
        ok: rs.filter(x => x.ok).length,
        err: rs.filter(x => !x.ok).length,
        p50: lat[Math.floor(lat.length * 0.5)] || 0,
        p95: lat[Math.floor(lat.length * 0.95)] || 0,
        max: lat[lat.length - 1] || 0,
        wall: Date.now() - t0,
        errSamples: rs.filter(x => !x.ok).slice(0, 2)
      });
    });
  }), { n });
}

/** P2/P3: 调用 stress 云函数（guardMs 必须作为参数传入，模拟器作用域拿不到 Node 变量） */
function callStress(mp, data, guardMs = 30000) {
  return guard(evalSafe(mp, p => new Promise(resolve => {
    const timer = setTimeout(() => resolve({ __clientTimeout: true }), p.guardMs);
    wx.cloud.callFunction({ name: 'stress', data: p.data })
      .then(r => { clearTimeout(timer); resolve({ result: r.result }); })
      .catch(e => { clearTimeout(timer); resolve({ __err: String((e && (e.errMsg || e.message)) || e).slice(0, 200) }); });
  }), { data, guardMs }), 'stress');
}

(async () => {
  const report = { startedAt: new Date().toISOString(), p1_client: [], p2_counts: null, p3_db: [], p3_deep: [] };
  let mp;
  try {
    mp = await Automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    console.log('✅ connected\n');
    await wait(2000);

    // ---------- P1 客户端真并发 ----------
    if (has('p1')) {
    console.log('=== P1 客户端真并发（真实 goods.list 链路）===');
    await clientBatch(mp, 1); // 预热
    await wait(500);
    for (const level of CLIENT_LEVELS) {
      const runs = [];
      for (let i = 0; i < REPS; i++) {
        const r = await clientBatch(mp, level);
        runs.push(r);
        if (r && r.ok !== undefined) {
          console.log(`  N=${level} rep${i + 1}: ok=${r.ok}/${r.n} err=${r.err} p50=${r.p50}ms p95=${r.p95}ms max=${r.max}ms wall=${r.wall}ms`);
        } else {
          console.log(`  N=${level} rep${i + 1}: ${JSON.stringify(r).slice(0, 160)}`);
        }
        await wait(700);
      }
      report.p1_client.push({ concurrency: level, runs });
    }
    }

    // ---------- P2 数据承载量 ----------
    if (has('p2')) {
    console.log('\n=== P2 数据承载量（各集合真实文档数）===');
    report.p2_counts = await callStress(mp, { mode: 'count' });
    console.log('  ', JSON.stringify(report.p2_counts).slice(0, 700));
    }

    // 取本校校名，用于 P3（独立于阶段开关）
    const schoolRes = await evalSafe(mp, () => new Promise(resolve => {
      wx.cloud.callFunction({ name: 'goods', data: { action: 'list', page: 1, pageSize: 1 } })
        .then(r => resolve({ school: r && r.result && r.result.data && r.result.data.school }))
        .catch(e => resolve({ err: String(e && (e.errMsg || e.message)).slice(0, 120) }));
    }));
    const school = (schoolRes && schoolRes.school) || '';
    console.log('  本校 campus =', JSON.stringify(school));
    report.school = school;

    // ---------- P3 数据库层并发 ----------
    if (has('p3')) {
    console.log('\n=== P3 数据库层并发（隔离查询直压）===');
    for (const level of DB_LEVELS) {
      const runs = [];
      for (let i = 0; i < REPS; i++) {
        const r = await callStress(mp, { mode: 'db', concurrency: level, rounds: 1, skip: 0, pageSize: 20, school });
        runs.push(r);
        const res = r && r.result;
        if (res) {
          console.log(`  db N=${level} rep${i + 1}: ok=${res.ok}/${res.total} err=${res.err} p50=${res.p50Ms}ms p95=${res.p95Ms}ms max=${res.maxMs}ms rows=${res.rowsReturned} batch=${res.avgBatchMs}ms`);
        } else {
          console.log(`  db N=${level} rep${i + 1}: ${JSON.stringify(r).slice(0, 200)}`);
        }
        await wait(700);
      }
      report.p3_db.push({ concurrency: level, runs });
    }
    }

    // ---------- P3b 深翻页成本 ----------
    if (has('p3')) {
    console.log('\n=== P3b 深翻页成本（固定并发 5，跳不同深度）===');
    for (const skip of [0, 500, 2000]) {
      const r = await callStress(mp, { mode: 'db', concurrency: 5, rounds: 1, skip, pageSize: 20, school });
      report.p3_deep.push({ skip, r });
      const res = r && r.result;
      if (res) {
        console.log(`  skip=${skip}: p50=${res.p50Ms}ms p95=${res.p95Ms}ms rows=${res.rowsReturned}`);
      } else {
        console.log(`  skip=${skip}: ${JSON.stringify(r).slice(0, 160)}`);
      }
      await wait(700);
    }
    }
  } catch (e) {
    report.fatal = String((e && e.stack) || e);
    console.error('FATAL', report.fatal);
  } finally {
    report.finishedAt = new Date().toISOString();
    const out = path.join(PROJECT, 'docs', 'stress_result.json');
    // 合并写入：保留历史阶段结果（如仅补跑 p2,p3 时不清掉 p1 数据）
    let merged = report;
    try {
      if (fs.existsSync(out)) {
        const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
        merged = Object.assign({}, prev, report);
        if (!report.p1_client || !report.p1_client.length) merged.p1_client = prev.p1_client || [];
        if (!report.p2_counts) merged.p2_counts = prev.p2_counts || null;
        if (!report.p3_db || !report.p3_db.length) merged.p3_db = prev.p3_db || [];
        if (!report.p3_deep || !report.p3_deep.length) merged.p3_deep = prev.p3_deep || [];
      }
    } catch (e) {}
    try { fs.writeFileSync(out, JSON.stringify(merged, null, 2), 'utf8'); console.log('\nsaved →', out); } catch (e) {}
    try { await mp.close(); } catch (e) {}
  }
})();
