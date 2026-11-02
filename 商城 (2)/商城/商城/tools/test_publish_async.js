const a = require('miniprogram-automator');
(async () => {
  const mp = await a.connect({ wsEndpoint: 'ws://localhost:9420' });
  const fid = 'cloud://cloud1-d6gxmdbcqf5d51f3e.636c-cloud1-d6gxmdbcqf5d51f3e-1479199796/goods/wxu-1788835575346_0_r8gu.jpg';
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const out = await mp.evaluate((fid) => wx.cloud.callFunction({
      name: 'goods',
      data: { action: 'publish', title: '异步_' + Date.now(), desc: '正常', images: [fid],
              price: 9.9, category: 'book', condition: 'almost_new', pickupPoint: '图书馆', type: 'sell' }
    }).then(r => ({ ok: r.result })).catch(e => ({ err: e.errCode, msg: String(e.errMsg).slice(0, 150) })), fid);
    console.log('publish(sell) #' + (i + 1) + ': ' + (Date.now() - t0) + 'ms ' + JSON.stringify(out).slice(0, 180));
  }
  await mp.disconnect();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
