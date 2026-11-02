// tools/live_audit.js
// 接手微信开发者工具：launch 起 IDE（开自动化 ws）→ 遍历全部页面
// → 抓 console.error / 页面 loadError → 扫描按钮
//
// 为什么用 launch 而不是 connect：
//   automator 的自动化协议需要 IDE 以 `--auto-port` 启动；
//   CLI `open` 只开项目窗口，9420 上是 CLI 的 HTTP server，automator 握手必失败。

const path = require('path');
const Automator = require('miniprogram-automator');

const CLI = 'D:\\weixinkaifa\\微信web开发者工具\\cli.bat';
const projectPath = path.join(__dirname, '..');

const TAB_PAGES = new Set([
  '/pages/index/index',
  '/pages/category/category',
  '/pages/publish/publish',
  '/pages/chat/chat',
  '/pages/mine/mine'
]);
const ERR_FIELDS = ['loadError', 'errMsg', 'error', 'errorMsg', 'loadFail', 'submitError', 'actionError'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const goodsId = process.argv[2] || 'e04f59456a9f771102dc84722888f359';
  const orderId = process.argv[3] || '10b550da6a9c13d701890e973743368b';

  const PAGES = [
    { path: '/pages/index/index', label: '首页' },
    { path: '/pages/category/category', label: '分类' },
    { path: '/pages/publish/publish', label: '发布' },
    { path: '/pages/chat/chat', label: '消息' },
    { path: '/pages/mine/mine', label: '我的' },
    { path: '/pages/search/search', label: '搜索' },
    { path: '/pages/sold/sold?status=onSale', label: '我的商品' },
    { path: '/pages/favorite/favorite', label: '我的收藏' },
    { path: '/pages/credit/credit', label: '信用分' },
    { path: '/pages/pickup/pickup', label: '自提点' },
    { path: '/pages/edit-profile/edit-profile', label: '编辑资料' },
    { path: '/pages/verify/verify', label: '学生认证' },
    { path: '/pages/login/login', label: '登录' },
    { path: '/pages/agreement/agreement', label: '用户协议' },
    { path: '/pages/privacy/privacy', label: '隐私政策' },
    { path: '/pages/feedback/feedback', label: '意见反馈' },
    { path: '/pages/admin/admin', label: '管理后台' },
    { path: goodsId ? `/pages/detail/detail?id=${goodsId}` : null, label: '商品详情' },
    { path: orderId ? `/pages/order-detail/order-detail?id=${orderId}` : null, label: '订单详情' },
    { path: orderId ? `/pages/review/review?orderId=${orderId}` : null, label: '评价' },
    { path: goodsId ? `/pages/report/report?targetType=goods&targetId=${goodsId}` : null, label: '举报' }
  ];

  // 用 connect（IDE 需以 `--auto-port 9420` 启动自动化服务）：
  //   & "<IDE>\cli.bat" auto --project "D:\商城" --auto-port 9420
  // 注意：必须用 localhost（127.0.0.1 连不上，IDE 自动化服务只认 localhost 解析）
  console.log('connecting IDE (ws://localhost:9420) …');
  const mp = await Automator.connect({
    wsEndpoint: 'ws://localhost:9420',
    projectPath,
    cwd: projectPath,
    timeout: 30000
  });
  console.log('✅ automation connected.\n');

  // 注入 console.error 收集器（覆盖后仍调用原方法，不影响 IDE 控制台显示）
  await mp.evaluate(() => {
    globalThis.__errs = [];
    if (!globalThis.__origErr) {
      globalThis.__origErr = console.error;
      console.error = function (...a) {
        try {
          globalThis.__errs.push(a.map(x => (x && (x.msg || x.message || x.errMsg)) || String(x)).join(' ').slice(0, 160));
        } catch (e) {}
        return globalThis.__origErr.apply(console, a);
      };
    }
  });

  const results = [];
  for (const p of PAGES) {
    if (!p.path) { results.push({ label: p.label, skipped: true }); continue; }
    let item = { label: p.label, path: p.path, errs: [], pageErr: '', buttons: 0, ok: false };
    try {
      await mp.evaluate(() => { globalThis.__errs = []; });
      // 导航：automator 的 mp.reLaunch/navigateTo 在当前自动化模式下抛
      // "Uncaught [object Object]"，改为在小程序运行时内直接调 wx.* API（已验证可用）
      const navOk = await mp.evaluate(url => new Promise((resolve) => {
        const done = r => resolve(!!r);
        wx.reLaunch({
          url,
          success: () => done(true),
          fail: e => { console.warn('[nav fail]', url, JSON.stringify(e)); done(false); }
        });
      }), p.path);
      if (!navOk) { item.errs.push('NAV_FAIL(rt): ' + p.path); throw new Error('nav fail'); }
      await sleep(2200);

      const r = await mp.evaluate(fields => {
        const errs = (globalThis.__errs || []).slice(0, 4);
        let pageErr = '';
        let route = '';
        try {
          const stack = getCurrentPages();
          const cur = stack[stack.length - 1];
          if (cur) {
            route = cur.route || '';
            if (cur.data) {
              for (const f of fields) {
                if (cur.data[f]) { pageErr = String(cur.data[f]).slice(0, 140); break; }
              }
            }
          }
        } catch (e) {}
        return { errs, pageErr, route };
      }, ERR_FIELDS);

      // 扫描按钮：原生 button 组件 + 常见可点击 class
      let buttons = 0;
      try {
        const pg = await mp.currentPage();
        const els = await pg.$$('button');
        buttons = (els && els.length) || 0;
      } catch (e) {}

      item.errs = r.errs;
      item.pageErr = r.pageErr;
      item.route = r.route;
      item.buttons = buttons;
      item.ok = !r.pageErr && r.errs.length === 0;
    } catch (e) {
      item.errs = ['NAV_FAIL: ' + String(e && e.message || e).slice(0, 120)];
    }
    results.push(item);
    const icon = item.skipped ? '⏭️' : (item.ok ? '✅' : '❌');
    console.log(`${icon} ${item.label}${item.route ? ' (' + item.route + ')' : ''} btns=${item.buttons}`);
    if (item.pageErr) console.log(`     pageErr: ${item.pageErr}`);
    item.errs.forEach(e => console.log(`     console: ${e}`));
  }

  const okCount = results.filter(r => r.ok).length;
  const errCount = results.filter(r => !r.ok && !r.skipped).length;
  console.log('\n==================================================');
  console.log(`总计 ${results.length} | ✅ ${okCount} | ❌ ${errCount}`);
  const bad = results.filter(r => !r.ok && !r.skipped);
  if (bad.length) {
    console.log('\n需要修补的页面：');
    bad.forEach(b => {
      console.log(`  ❌ ${b.label}: ${b.pageErr || b.errs.join(' | ')}`);
    });
  }
  await mp.close();
  console.log('\ndone.');
})().catch(e => { console.error('FATAL', e && (e.message || e)); process.exit(1); });
