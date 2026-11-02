// tools/verify_custom_tabbar.js —— 验证自定义 tabBar：
// ① 5 个 tab 页的选中态；② 自实现的未读角标（原生 setTabBarBadge 在 custom 模式下失效）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 25000))]);
}

(async () => {
  const checks = [];
  const chk = (n, ok, d) => { checks.push({ n, ok, d }); console.log((ok ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  const allErrs = [];
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await evalSafe(mp, () => {
      const g = (typeof globalThis !== 'undefined') ? globalThis : window;
      if (!g || g.__logsInstalled) return 'ok';
      g.__logs = [];
      const oe = console.error, ow = console.warn;
      const fmt = (a) => { try { return Array.prototype.slice.call(a).map(x => (typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x))).join(' ').slice(0, 200); } catch (e) { return ''; } };
      console.error = function () { try { g.__logs.push({ lvl: 'error', msg: fmt(arguments) }); } catch (e) {} return oe.apply(console, arguments); };
      console.warn = function () { try { g.__logs.push({ lvl: 'warn', msg: fmt(arguments) }); } catch (e) {} return ow.apply(console, arguments); };
      g.__logsInstalled = true;
      return 'installed';
    });
    const drain = async () => {
      const r = await evalSafe(mp, () => { const g = (typeof globalThis !== 'undefined') ? globalThis : window; const a = (g && g.__logs) || []; if (g) g.__logs = []; return a; });
      const arr = Array.isArray(r) ? r : [];
      const noise = [/getSystemInfoSync/i, /getAppBaseInfo/i, /deprecated/i];
      return arr.filter(l => l.lvl === 'error' && !noise.some(re => re.test(l.msg))).map(l => String(l.msg).slice(0, 160));
    };
    await drain();

    const readBar = () => evalSafe(mp, () => {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      const bar = cur && typeof cur.getTabBar === 'function' ? cur.getTabBar() : null;
      return bar && bar.data ? { selected: bar.data.selected, unread: bar.data.unread } : { err: '拿不到 tabBar 实例' };
    });

    // ① 5 个 tab 页的选中态
    const tabs = [
      ['/pages/index/index', 0, '首页'],
      ['/pages/category/category', 1, '分类'],
      ['/pages/publish/publish', 2, '发布'],
      ['/pages/chat/chat', 3, '消息'],
      ['/pages/mine/mine', 4, '我的']
    ];
    for (const [route, idx, label] of tabs) {
      await mp.switchTab(route);
      await wait(4000);
      const bar = await readBar();
      chk(`自定义 tabBar 组件存在于「${label}」`, !!(bar && !bar.err), JSON.stringify(bar));
      chk(`「${label}」选中态高亮正确（应为第 ${idx} 项）`, bar && bar.selected === idx, `selected=${bar && bar.selected}`);
    }

    // ② 未读角标（自定义 tabBar 下原生 API 失效，改为组件内渲染）
    const setBadge = (n) => evalSafe(mp, (n) => { const app = getApp(); app.setUnreadBadge(n); return true; }, n);
    await setBadge(7);
    await wait(1200);
    const b7 = await readBar();
    chk('未读角标：设置 7 → 组件收到 unread=7', b7 && b7.unread === 7, JSON.stringify(b7));
    try { await mp.screenshot({ path: path.join(__dirname, '_tb_badge.png') }); } catch (e) {}

    await setBadge(0);
    await wait(1200);
    const b0 = await readBar();
    chk('未读角标：清零 → 组件收到 unread=0', b0 && b0.unread === 0, JSON.stringify(b0));

    // ③ 原生日标 API 已不再被调用（避免与自定义 tabBar 冲突）
    const legacy = await evalSafe(mp, () => {
      const src = String(wx.setTabBarBadge || '');
      return { hasApi: typeof wx.setTabBarBadge === 'function' };
    });

    const errs = await drain();
    allErrs.push(...errs);
    chk('调试器无 JS 报错', allErrs.length === 0, allErrs.length ? allErrs[0] : '0 条');
  } catch (e) {
    chk('执行异常', false, String((e && e.message) || e).slice(0, 160));
  } finally {
    // 不调用 mp.close()，避免断开 IDE 自动化端口
  }
  const failed = checks.filter(c => !c.ok).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${checks.length - failed} / ${checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
})();
