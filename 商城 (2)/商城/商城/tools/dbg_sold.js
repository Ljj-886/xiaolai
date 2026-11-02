const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  await mp.reLaunch('/pages/sold/sold');
  await new Promise(r => setTimeout(r, 2000));
  const p = await mp.currentPage();
  console.log('currentPage:', p.path);
  const sysPage = (await mp.evaluate(() => {
    const last = getCurrentPages()[getCurrentPages().length - 1];
    return { route: last.route, isSelf: last.data && last.data.isSelf, sellerOpenid: last.data && last.data.sellerOpenid };
  }));
  console.log('via eval:', JSON.stringify(sysPage));
  const directData = await (p.data ? p : (await mp.currentPage())).data();
  console.log('direct isSelf:', directData.isSelf, 'sellerOpenid:', directData.sellerOpenid);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
