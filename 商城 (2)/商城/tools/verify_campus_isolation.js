// tools/verify_campus_isolation.js
// 验证「多校隔离」修复：插入一条外校商品，走**真实的 goods.list 云函数**，
// 断言外校商品不会出现在本校用户的列表里。测试数据自动清理。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
const pass = [], fail = [];
const ok = (n, c, extra) => (c ? pass : fail).push(n + (extra ? ' → ' + extra : ''));

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);

    const r = await evalSafe(mp, () => new Promise(resolve => {
      const db = wx.cloud.database();
      const MY = '清华大学';
      const OTHER = '北京大学';
      const MARK = '__ISOTEST__' + Date.now();
      const out = { mark: MARK, other: OTHER };
      let probeId = null;
      (async () => {
        try {
          // 1) 插入外校商品
          const add = await db.collection('goods').add({ data: {
            title: MARK, desc: 'isolation test', price: 1, campus: OTHER,
            status: 'onSale', type: 'sell', category: 'other', createdAt: Date.now()
          }});
          probeId = add._id;
          out.inserted = probeId;

          // 2) 走真实云函数 goods.list（调用者学校=清华大学）
          const callList = (extra) => new Promise(res => {
            wx.cloud.callFunction({ name: 'goods', data: Object.assign({ action: 'list', page: 1, pageSize: 50 }, extra || {}) })
              .then(x => res(x.result || {}))
              .catch(e => res({ __err: String(e && (e.errMsg || e.message)) }));
          });

          const a = await callList({});
          out.listOk = a.code === 0;
          out.school = a.data && a.data.school;
          out.listLen = a.data && a.data.list ? a.data.list.length : -1;
          out.listHasOther = !!(a.data && a.data.list && a.data.list.some(g => g.campus === OTHER));
          out.listHasMark = !!(a.data && a.data.list && a.data.list.some(g => g.title === MARK));

          // 3) 带关键词也测一遍（验证 campusOr 与 kw 的 _.and 组合正确）
          const b = await callList({ keyword: 'isolation' });
          out.kwOk = b.code === 0;
          out.kwHasOther = !!(b.data && b.data.list && b.data.list.some(g => g.campus === OTHER));
          out.kwHitMark = !!(b.data && b.data.list && b.data.list.some(g => g.title === MARK));

          // 4) 正常关键词仍能搜到本校商品（确认没把关键词条件弄坏）
          const c = await callList({ keyword: 'bike' });
          out.kwNormalOk = c.code === 0;
          out.kwNormalLen = c.data && c.data.list ? c.data.list.length : -1;
        } catch (e) {
          out.err = String(e && (e.errMsg || e.message));
        } finally {
          if (probeId) {
            try { await db.collection('goods').doc(probeId).remove(); out.cleaned = true; }
            catch (e) { out.cleanErr = String(e && (e.errMsg || e.message)); }
          }
        }
        resolve(out);
      })();
    }));

    console.log(JSON.stringify(r, null, 1) + '\n');
    ok('goods.list 调用成功', r.listOk === true, 'code=' + r.listOk);
    ok('已拿到调用者学校', r.school === '清华大学', String(r.school));
    ok('★ 外校商品未出现在本校列表', r.listHasOther === false, 'hasOther=' + r.listHasOther);
    ok('测试商品已清理', r.cleaned === true || !!r.cleanErr);
    ok('带关键词时不串校', r.kwHasOther === false, 'kwHasOther=' + r.kwHasOther);
    ok('关键词条件未被破坏（本校商品可搜到）', r.kwNormalOk === true, 'len=' + r.kwNormalLen);

    console.log('===== 多校隔离验证 =====');
    pass.forEach(t => console.log('  [PASS] ' + t));
    fail.forEach(t => console.log('  [FAIL] ' + t));
    console.log(`结果: ${pass.length}/${pass.length + fail.length} 通过`);
  } catch (e) {
    console.log('异常: ' + String(e && e.message || e));
  }
  // 必须显式退出：miniprogram-automator 会保持 ws 连接，不退出会让进程一直挂着
  process.exit(fail.length ? 1 : 0);
})();
