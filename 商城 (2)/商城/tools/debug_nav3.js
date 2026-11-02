const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const page = await mp.reLaunch('/pages/index/index');
  await new Promise(r => setTimeout(r, 1500));
  console.log('route:', page.path);
  console.log('goods-card:', !!(await page.$('goods-card')));
  console.log('nav-bar via $$:', (await page.$$('goods-card')).length);
  // 试 pickup 页
  const p2 = await mp.reLaunch('/pages/pickup/pickup');
  await new Promise(r => setTimeout(r, 1500));
  console.log('p2 route:', p2.path);
  const root = await p2.$('.page');
  console.log('.page found:', !!root);
  if (root) {
    const nb = await root.$('nav-bar');
    console.log('nav-bar inside .page:', !!nb);
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
