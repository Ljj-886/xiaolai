// 快速调试 nav-bar 选择器 + loadMore 是否已加载
const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const page = await mp.reLaunch('/pages/detail/detail');
  await new Promise(r => setTimeout(r, 1500));
  const s1 = await page.$('nav-bar');
  console.log('$(nav-bar):', s1 ? 'found' : 'null');
  const s2 = await page.$$('nav-bar');
  console.log('$$(nav-bar):', s2.length);
  const s3 = await page.$('.navbar');
  console.log('$(.navbar):', s3 ? 'found' : 'null');
  // 用 evaluate 直接看页面栈方法
  const r = await mp.evaluate(() => {
    const p = getCurrentPages();
    const last = p[p.length - 1];
    return { route: last.route, hasLoadMore: typeof last.loadMore, keys: Object.keys(last).filter(k => k.toLowerCase().includes('load')) };
  });
  console.log('evaluate:', JSON.stringify(r));
  // data 检查 detail item
  const d = await page.data();
  console.log('item loaded:', !!d.item);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
