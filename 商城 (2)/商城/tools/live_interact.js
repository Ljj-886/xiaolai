// tools/live_interact.js
// 真机功能/按钮测试：
//   1. 枚举每个页面实例的方法（按钮 bindtap 绑定的 handler 就是这些方法）
//   2. 调用「安全方法」验证业务逻辑不崩（跳过删除/支付/提交等破坏性操作）
//   3. 对最近修改的模块做定向测试（chat 长按删除 / detail 想要收藏 / publish 切换 / index 刷新）
//
// 导航统一用运行时 wx.reLaunch（automator 的 reLaunch API 会抛 Uncaught [object Object]）

const path = require('path');
const Automator = require('miniprogram-automator');
const projectPath = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 需要真实事件对象 e 的 handler：直接调会读 e.currentTarget.dataset 而 TypeError（误报），
// 必须传入模拟事件；导航类（go*/navigate*/switch*）会真的跳转，破坏测试流程，跳过。
// 破坏性/需真实上下文：submit/pay/delete/remove/upload 等跳过。
const SKIP_METHODS = /(remove|delete|del|submit|pay|buy|order|ban|logout|clear|confirm|verify|report|review|send|upload|go|navigate|switch|open|choose|preview|share|login|auth)/i;

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
  { path: '/pages/feedback/feedback', label: '意见反馈' },
  { path: '/pages/detail/detail?id=e04f59456a9f771102dc84722888f359', label: '商品详情' }
];

(async () => {
  const mp = await Automator.connect({
    wsEndpoint: 'ws://localhost:9420',
    projectPath, cwd: projectPath, timeout: 30000
  });
  console.log('✅ connected\n');

  const report = [];
  for (const p of PAGES) {
    try {
      await mp.evaluate(url => new Promise(r => {
        wx.reLaunch({ url, success: () => r(true), fail: () => r(false) });
      }), p.path);
      await sleep(1800);

      // 枚举页面实例方法（按钮 handler）
      const info = await mp.evaluate(() => {
        try {
          const s = getCurrentPages();
          const cur = s[s.length - 1];
          if (!cur) return { route: '', methods: [], err: 'no page' };
          const proto = Object.getPrototypeOf(cur);
          const methods = Object.getOwnPropertyNames(proto)
            .filter(k => typeof cur[k] === 'function' && k !== 'constructor');
          return { route: cur.route || '', methods };
        } catch (e) { return { route: '', methods: [], err: String(e) }; }
      });

      const safe = (info.methods || []).filter(m => !SKIP_METHODS.test(m));
      const skipped = (info.methods || []).filter(m => SKIP_METHODS.test(m));

      // 逐个调用，传入「模拟事件对象」避免 e.currentTarget 为 undefined 的误报
      const failed = [];
      for (const m of safe) {
        try {
          await mp.evaluate(mname => new Promise(resolve => {
            const s = getCurrentPages();
            const cur = s[s.length - 1];
            if (!cur || typeof cur[mname] !== 'function') return resolve();
            const fakeEvent = {
              currentTarget: { dataset: {}, offsetLeft: 0, id: '' },
              target: { dataset: {}, offsetLeft: 0, id: '' },
              detail: { value: '', x: 0, y: 0 }
            };
            let r;
            try { r = cur[mname](fakeEvent); }
            catch (e) { return resolve(String(e && e.message || e).slice(0, 80)); }
            if (r && typeof r.catch === 'function') r.catch(e => resolve(String(e && e.message || e).slice(0, 80)));
            else if (r && typeof r.then === 'function') r.then(() => resolve(''), e => resolve(String(e && e.message || e).slice(0, 80)));
            else resolve('');
          }), m).then(msg => { if (msg) failed.push(`${m}: ${msg}`); });
          await sleep(150);
        } catch (e) {
          failed.push(`${m}: ${String(e && e.message || e).slice(0, 70)}`);
        }
      }

      report.push({ label: p.label, route: info.route, methods: info.methods, safe, skipped, failed });
      const icon = failed.length ? '❌' : '✅';
      console.log(`${icon} ${p.label} (${info.route}) 方法 ${info.methods.length} 个 | 安全调 ${safe.length} | 破坏性跳过 ${skipped.length}`);
      failed.forEach(f => console.log(`     ✗ ${f}`));
    } catch (e) {
      report.push({ label: p.label, err: String(e && e.message || e).slice(0, 100) });
      console.log(`❌ ${p.label} 巡检失败: ${String(e && e.message || e).slice(0, 90)}`);
    }
  }

  console.log('\n================ 方法清单 ================');
  report.forEach(r => {
    if (r.err) return console.log(`\n[${r.label}] ERR ${r.err}`);
    console.log(`\n[${r.label}] ${r.route}`);
    console.log(`  可调用: ${r.safe.join(', ') || '无'}`);
    console.log(`  跳过(破坏性): ${r.skipped.join(', ') || '无'}`);
    if (r.failed && r.failed.length) console.log(`  ❌ 失败: ${r.failed.join(' | ')}`);
  });

  const bad = report.filter(r => r.failed && r.failed.length);
  console.log('\n==========================================');
  console.log(`页面 ${report.length} | 有方法失败 ${bad.length}`);

  await mp.close();
  console.log('done.');
})().catch(e => { console.error('FATAL', e && (e.message || e)); process.exit(1); });
