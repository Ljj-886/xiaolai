// tools/live_full_check.js
// 真实运行小程序，遍历关键页面截图 + 读取状态。
// 用法：npm run live:full（开发者工具须已启动）

const automator = require('miniprogram-automator');

const PAGES = [
  { path: '/pages/index/index', label: '首页', expect: { list: '>0 或 loadError 为空' } },
  { path: '/pages/publish/publish', label: '发布-出售', expect: { form_type: 'sell' } },
  { path: '/pages/category/category', label: '分类', expect: {} },
  { path: '/pages/search/search', label: '搜索', expect: {} },
  { path: '/pages/mine/mine', label: '我的', expect: {} }
];

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  } catch (e) {
    console.error('❌ 连不上开发者工具（端口 9420）');
    process.exit(1);
  }
  console.log('✅ 已连接开发者工具');

  let failCount = 0;
  for (const p of PAGES) {
    try {
      const isTab = ['/pages/index/index', '/pages/publish/publish', '/pages/category/category', '/pages/mine/mine'].includes(p.path);
      if (isTab) await mp.switchTab(p.path);
      else await mp.reLaunch(p.path);
      await new Promise(r => setTimeout(r, 3500));
      const fname = `live_${p.label.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      await mp.screenshot({ path: `D:/商城/.workbuddy/tmp/${fname}` });
      const pg = await mp.currentPage();
      const d = await pg.data();
      const status = d.loadError ? `❌ loadError=${d.loadError.slice(0, 60)}` : '✅ 正常';
      console.log(`${p.label.padEnd(8)} (${p.path}) → ${status}`);
      if (p.expect.list === '>0 或 loadError 为空' && (d.list || []).length === 0 && d.loadError) {
        failCount++;
      }
    } catch (e) {
      console.log(`${p.label} → ❌ ${e.message}`);
      failCount++;
    }
  }

  await mp.close();
  console.log(`\n=== 完成，${failCount} 个失败 ===`);
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });