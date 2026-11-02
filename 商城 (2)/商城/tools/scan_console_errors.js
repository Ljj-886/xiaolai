// 全页面遍历 + 调试器报错抓取
const automator = require('miniprogram-automator');

const PAGES = [
  '/pages/index/index',
  '/pages/category/category',
  '/pages/publish/publish',
  '/pages/chat/chat',
  '/pages/mine/mine',
  '/pages/search/search',
  '/pages/login/login',
  '/pages/order/order',
  '/pages/favorite/favorite',
  '/pages/pickup/pickup',
  '/pages/admin/admin',
  '/pages/edit-profile/edit-profile',
  '/pages/sold/sold',
  '/pages/credit/credit',
  '/pages/agreement/agreement',
  '/pages/verify/verify',
];

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });

  const errors = [];   // {page, type, args}
  const warnings = [];
  mp.on('console', (msg) => {
    if (msg.type === 'error') errors.push(msg.args.join(' '));
    else if (msg.type === 'warning') warnings.push(msg.args.join(' '));
  });
  mp.on('exception', (exc) => {
    errors.push('[exception] ' + (exc.message || JSON.stringify(exc)));
  });

  for (const p of PAGES) {
    const before = errors.length;
    const beforeW = warnings.length;
    try {
      await mp.reLaunch(p);
      await new Promise(r => setTimeout(r, 2500));
      const cur = await mp.currentPage();
      const curPath = cur ? cur.path : '?';
      const newE = errors.slice(before), newW = warnings.slice(beforeW);
      console.log(`${newE.length === 0 && newW.length === 0 ? 'OK  ' : 'WARN'} | ${p} -> ${curPath}`);
      newW.forEach(w => console.log('   [warning] ' + w.slice(0, 300)));
      newE.forEach(e => console.log('   [ERROR]   ' + e.slice(0, 500)));
    } catch (err) {
      console.log(`FAIL | ${p} -> ${err.message.slice(0, 200)}`);
    }
  }

  console.log('\n=== 汇总 ===');
  console.log(`errors: ${errors.length}, warnings: ${warnings.length}`);
  mp.disconnect();
})().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
