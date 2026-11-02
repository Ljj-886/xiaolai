// 探针：在 appService 上下文直接调云函数，拿具体错误信息
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const fns = ['login', 'user', 'goods', 'school'];
  for (const fn of fns) {
    const out = await mp.evaluate((fn) => new Promise(resolve => {
      wx.cloud.callFunction({ name: fn, data: { action: 'ping' } })
        .then(r => resolve(fn + ' OK -> ' + JSON.stringify(r.result).slice(0, 200)))
        .catch(e => resolve(fn + ' FAIL -> code=' + e.errCode + ' msg=' + e.errMsg));
    }), fn);
    console.log(out);
  }
  mp.disconnect();
})().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
