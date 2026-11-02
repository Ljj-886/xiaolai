// tools/live_home.js
// 真实运行小程序，截首页 + 读 list/loadError 状态。
// 用法：npm run live:home（开发者工具须已启动并开启自动化端口 9420）

const automator = require('miniprogram-automator');

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  } catch (e) {
    console.error('❌ 连不上开发者工具（端口 9420）。先启动开发者工具并开自动化：');
    console.error('   npm run devtools:auto');
    process.exit(1);
  }
  console.log('✅ 已连接开发者工具');

  await mp.reLaunch('/pages/index/index');
  await new Promise(r => setTimeout(r, 5000));
  await mp.screenshot({ path: 'D:/商城/.workbuddy/tmp/live_home.png' });

  const pg = await mp.currentPage();
  const d = await pg.data();
  console.log('=== 首页真实状态 ===');
  console.log('商品数      =', (d.list || []).length);
  console.log('loadError   =', d.loadError || '(无错误 ✅)');
  console.log('needSchool  =', d.needSchool);
  console.log('school      =', d.school || '(空)');
  console.log('type        =', d.type);
  if (d.list && d.list.length) {
    console.log('商品列表:');
    d.list.slice(0, 5).forEach(g => {
      console.log(`  · ${g.title} ¥${g.price} (type=${g.type || '无'})`);
    });
  }

  await mp.close();
  process.exit(d.loadError ? 1 : 0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });