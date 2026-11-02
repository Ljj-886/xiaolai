// tools/shot_recheck.js —— 临时把一件在售商品下架（进二次审核队列），截图商品管理页，再恢复
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
  let mp, id;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    const callFn = (n, d) => evalSafe(mp, (n, d) => wx.cloud.callFunction({ name: n, data: d })
      .then(r => r.result).catch(e => ({ __err: String((e && (e.errMsg || e.message)) || e) })), n, d);

    const os = await callFn('admin', { action: 'listGoods', status: 'onSale', pageSize: 1 });
    const g = os && os.data && os.data.list && os.data.list[0];
    if (!g) { console.log('无在售商品'); process.exit(0); }
    id = g._id;
    console.log('测试商品:', id, g.title);
    const off = await callFn('admin', { action: 'adminOff', id, reason: '演示-待二次审核' });
    console.log('下架:', JSON.stringify(off));

    await mp.reLaunch('/pages/admin-goods/admin-goods?tab=recheck');
    await wait(7000);
    const f = path.join(__dirname, '_shot_recheck.png');
    await mp.screenshot({ path: f });
    console.log('截图: ' + f);

    const rc = await callFn('admin', { action: 'recheckGoods', id, decision: 'onSale' });
    console.log('恢复:', JSON.stringify(rc));
  } catch (e) {
    console.log('异常: ' + String((e && e.message) || e).slice(0, 160));
    if (mp && id) { try { await evalSafe(mp, (i) => wx.cloud.callFunction({ name: 'admin', data: { action: 'recheckGoods', id: i, decision: 'onSale' } }), id); } catch (e2) {} }
  }
  process.exit(0);
})();
