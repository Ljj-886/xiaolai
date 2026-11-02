// tools/e2e_sorts.js —— 独立脚本：分类页四种排序（全新 automator 连接，避免长会话超时）
const automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  let fail = 0;
  const ok = n => console.log('  ✅ ' + n);
  const bad = (n, d) => { fail++; console.log('  ❌ ' + n + (d ? ' :: ' + String(d).slice(0, 160) : '')); };

  console.log('=== 分类页四种排序（点击筛选条）===');
  await mp.reLaunch('/pages/category/category');
  await sleep(4000);
  const cat = await mp.currentPage();

  const order = [
    { i: 0, s: 'new', label: '最新' },
    { i: 1, s: 'priceAsc', label: '价低' },
    { i: 2, s: 'priceDesc', label: '价高' },
    { i: 3, s: 'hot', label: '热门' },
  ];
  for (const o of order) {
    try {
      const items = await cat.$$('.filter-item');
      if (!items || !items[o.i]) { bad(`找不到第 ${o.i} 个筛选条`); continue; }
      await items[o.i].tap();
      await sleep(4000);
      const cd = await cat.data();
      const l = (cd && cd.list) || [];
      if (!Array.isArray(l)) { bad(`sort=${o.s} 列表非数组`); continue; }
      ok(`sort=${o.s}(${o.label}) 返回 ${l.length} 条`);
      if (o.s === 'new' && l.length >= 2) {
        let desc = true;
        for (let i = 1; i < l.length; i++) if ((l[i].createdAt || 0) > (l[i - 1].createdAt || 0)) desc = false;
        desc ? ok('「最新」按发布时间倒序正确') : bad('「最新」未按发布时间倒序');
      }
      if (o.s === 'priceAsc' && l.length >= 2) {
        const ps = l.map(g => g.price).filter(v => typeof v === 'number');
        let asc = true;
        for (let i = 1; i < ps.length; i++) if (ps[i] < ps[i - 1]) asc = false;
        asc ? ok('「价低」价格升序正确') : bad('「价低」未按价格升序');
      }
      if (o.s === 'priceDesc' && l.length >= 2) {
        const ps = l.map(g => g.price).filter(v => typeof v === 'number');
        let desc = true;
        for (let i = 1; i < ps.length; i++) if (ps[i] > ps[i - 1]) desc = false;
        desc ? ok('「价高」价格降序正确') : bad('「价高」未按价格降序');
      }
    } catch (e) { bad(`sort=${o.s} 交互异常`, e.message); }
  }

  console.log(`\n失败项: ${fail}`);
  await mp.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
