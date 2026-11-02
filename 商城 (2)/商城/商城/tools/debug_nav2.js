const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const page = await mp.reLaunch('/pages/pickup/pickup');
  await new Promise(r => setTimeout(r, 1200));
  console.log('views:', (await page.$$('view')).length);
  console.log('nav-bar tag:', !!(await page.$('nav-bar')));
  console.log('empty tag:', !!(await page.$('empty')));
  const sysPage = await mp.currentPage();
  console.log('route:', sysPage.path);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
