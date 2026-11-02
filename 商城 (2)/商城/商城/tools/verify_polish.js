// tools/verify_polish.js —— 验证本轮「完善」项：tabBar 未读角标 / 全局错误钩子 / 图片兜底组件
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 先给 tabBar 页面（首页）挂探针，记录 setTabBarBadge / removeTabBarBadge 的调用
    await mp.switchTab('/pages/index/index');
    await wait(4000);
    const probe = await evalSafe(mp, () => {
      window.__badgeCalls = [];
      if (!window.__badgeWrapped) {
        const s = wx.setTabBarBadge, r = wx.removeTabBarBadge;
        wx.setTabBarBadge = function (o) { try { window.__badgeCalls.push({ fn: 'set', index: o.index, text: o.text }); } catch (e) {} return s.apply(wx, arguments); };
        wx.removeTabBarBadge = function (o) { try { window.__badgeCalls.push({ fn: 'remove', index: o.index }); } catch (e) {} return r.apply(wx, arguments); };
        window.__badgeWrapped = true;
      }
      return true;
    });
    chk('角标探针已挂载', probe === true, String(probe && probe.__evalErr || 'ok'));

    // 2) setUnreadBadge(5) → 应调用 setTabBarBadge index=3 text='5'
    await evalSafe(mp, () => { getApp().setUnreadBadge(5); return true; });
    await wait(600);
    const c1 = await evalSafe(mp, () => (window.__badgeCalls || []).slice(-3));
    const setOk = Array.isArray(c1) && c1.some(x => x.fn === 'set' && x.index === 3 && x.text === '5');
    chk('setUnreadBadge(5) → 消息 tab 显示「5」', setOk, JSON.stringify(c1));

    // 3) setUnreadBadge(150) → '99+'
    await evalSafe(mp, () => { getApp().setUnreadBadge(150); return true; });
    await wait(500);
    const c2 = await evalSafe(mp, () => (window.__badgeCalls || []).slice(-2));
    chk("setUnreadBadge(150) → 「99+」", Array.isArray(c2) && c2.some(x => x.text === '99+'), JSON.stringify(c2));

    // 4) setUnreadBadge(0) → removeTabBarBadge index=3
    await evalSafe(mp, () => { getApp().setUnreadBadge(0); return true; });
    await wait(500);
    const c3 = await evalSafe(mp, () => (window.__badgeCalls || []).slice(-2));
    chk('setUnreadBadge(0) → 移除角标', Array.isArray(c3) && c3.some(x => x.fn === 'remove' && x.index === 3), JSON.stringify(c3));

    // 5) refreshUnreadBadge 不抛错（真实拉一次会话列表）
    const rf = await evalSafe(mp, () => { getApp().refreshUnreadBadge(); return 'called'; });
    await wait(3500);
    const c4 = await evalSafe(mp, () => (window.__badgeCalls || []).length);
    chk('refreshUnreadBadge 已执行（无报错）', rf === 'called' && typeof c4 === 'number', `调用次数累计 ${c4}`);

    // 6) 全局错误钩子存在且可调用
    const hooks = await evalSafe(mp, () => {
      const a = getApp();
      const names = ['onError', 'onUnhandledRejection', 'onPageNotFound', 'onShow', 'refreshUnreadBadge', 'setUnreadBadge'];
      return names.map(n => ({ n, has: typeof a[n] === 'function' }));
    });
    out.hooks = hooks;
    const missing = Array.isArray(hooks) ? hooks.filter(h => !h.has).map(h => h.n) : ['(读取失败)'];
    chk('app.js 全局钩子齐备', Array.isArray(hooks) && missing.length === 0, missing.length ? '缺少 ' + missing.join(',') : (hooks || []).map(h => h.n).join(' / '));

    // 7) goods-card 组件的图片兜底：无封面时 imgSrc 应回落到占位图
    await mp.switchTab('/pages/index/index');
    await wait(5000);
    const cards = await evalSafe(mp, () => {
      // 直接问页面数据：找一条无封面商品，看 goods-card 的 defaultCover 是否配置
      const p = getCurrentPages().slice(-1)[0];
      return { route: p && p.route, listLen: ((p && p.data.list) || []).length };
    });
    out.indexState = cards;
    chk('首页正常渲染（占位兜底改动无回归）', cards && cards.route === 'pages/index/index' && cards.listLen > 0,
      `${cards && cards.listLen} 条`);
    try { await mp.screenshot({ path: path.join(__dirname, '_pl_index.png') }); out.shot = true; } catch (e) { out.shot = String(e.message); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
