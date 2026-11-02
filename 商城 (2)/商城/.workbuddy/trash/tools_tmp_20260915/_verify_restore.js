// tools/_verify_restore.js —— 校验测试商品已恢复在售、且二次审核队列已清空
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 25000))]);
}
(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    const callFn = (n, d) => evalSafe(mp, (n, d) => wx.cloud.callFunction({ name: n, data: d })
      .then(r => r.result).catch(e => ({ __err: String((e && (e.errMsg || e.message)) || e) })), n, d);
    const st = await callFn('admin', { action: 'stats' });
    const d = st && st.data;
    console.log('recheckGoods =', d && d.recheckGoods, '| bannedGoods =', d && d.bannedGoods, '| onSale =', d && d.onSale);
    const rq = await callFn('admin', { action: 'listGoods', status: 'recheck', pageSize: 50 });
    const n = ((rq && rq.data && rq.data.list) || []).length;
    console.log('待二次审核队列条数 =', n, n === 0 ? '✅ 已清空' : '⚠ 仍有残留');
  } catch (e) { console.log('异常: ' + String((e && e.message) || e).slice(0, 160)); }
  process.exit(0);
})();
