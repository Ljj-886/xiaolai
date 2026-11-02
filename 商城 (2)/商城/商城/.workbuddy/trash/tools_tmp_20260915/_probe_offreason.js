// tools/_probe_offreason.js —— 探测 off 状态商品的 offReason 到底是真实数据还是展示 bug
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
    const r = await evalSafe(mp, () => new Promise(resolve => {
      wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' });
      wx.cloud.callFunction({
        name: 'admin', data: { action: 'listGoods', status: 'all', page: 0, pageSize: 50 },
        success: res => {
          const l = (res.result && res.result.data && res.result.data.list) || [];
          resolve(l.map(g => ({
            id: g._id, status: g.status, offType: g.offType,
            offReason: g.offReason, banReason: g.banReason,
            recheck: g.recheck, recheckNote: g.recheckNote
          })));
        },
        fail: e => resolve({ err: String(e && e.errMsg || e) })
      });
    }));
    console.log(JSON.stringify(r, null, 1));
  } catch (e) { console.log('异常: ' + String(e && e.message || e)); }
})();
