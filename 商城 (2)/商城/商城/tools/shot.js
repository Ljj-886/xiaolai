const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  await mp.reLaunch('/pages/pickup/pickup');
  await new Promise(r => setTimeout(r, 1500));
  await mp.screenshot({ path: 'D:/商城/tools/shot_pickup.png' });
  await mp.reLaunch('/pages/detail/detail');
  await new Promise(r => setTimeout(r, 1500));
  await mp.screenshot({ path: 'D:/商城/tools/shot_detail.png' });
  console.log('done');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
