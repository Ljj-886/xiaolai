// tools/verify_img_fallback.js —— 验证新增的图片失败兜底是否生效
// 当前云存储处于停服状态（451），正好是天然的失败场景。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
async function installConsoleCapture(mp) {
  return evalSafe(mp, () => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (!g) return 'no-global';
    if (g.__logsInstalled) return 'already';
    g.__logs = [];
    const oe = console.error, ow = console.warn;
    const fmt = (a) => { try { return Array.prototype.slice.call(a).map(x => (typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x))).join(' ').slice(0, 200); } catch (e) { return ''; } };
    console.error = function () { try { g.__logs.push({ lvl: 'error', msg: fmt(arguments) }); } catch (e) {} return oe.apply(console, arguments); };
    console.warn = function () { try { g.__logs.push({ lvl: 'warn', msg: fmt(arguments) }); } catch (e) {} return ow.apply(console, arguments); };
    g.__logsInstalled = true;
    return 'installed';
  });
}
async function drain(mp) {
  const r = await evalSafe(mp, () => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    const out = (g && g.__logs) || []; if (g) g.__logs = []; return out;
  });
  return Array.isArray(r) ? r : [];
}

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  const allErrs = [];
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await installConsoleCapture(mp);

    const GID = 'e04f59456a9f771102dc84722888f359';

    // 1) 商品详情页：大图失败应回退占位图（imgErr 有键）
    await drain(mp);
    await mp.reLaunch(`/pages/detail/detail?id=${GID}`);
    await wait(10000);
    const d = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const dt = (p && p.data) || {};
      return {
        route: p && p.route,
        hasItem: !!(dt.item && dt.item._id),
        imgCount: (dt.item && dt.item.images || []).length,
        imgErrKeys: Object.keys(dt.imgErr || {}),
        avatarErr: !!dt.avatarErr,
        defaultCover: dt.defaultCover
      };
    });
    out.detail = d;
    console.log('[detail]', JSON.stringify(d));
    chk('详情页大图加载失败已标记（回退占位图）', !!(d && d.imgErrKeys && d.imgErrKeys.length > 0),
      `图片${d && d.imgCount}张，失败标记 ${d && d.imgErrKeys && d.imgErrKeys.length} 个`);
    chk('详情页占位图已配置', !!(d && d.defaultCover), String(d && d.defaultCover));
    try { await mp.screenshot({ path: path.join(__dirname, '_fb_detail.png') }); } catch (e) {}
    const log1 = await drain(mp);
    allErrs.push(...log1.filter(l => l.lvl === 'error'));

    // 2) 我的页：头像失败应回退默认头像
    await mp.reLaunch('/pages/mine/mine');
    await wait(9000);
    const m = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const dt = (p && p.data) || {};
      return { route: p && p.route, avatarErr: !!dt.avatarErr, hasUser: !!(dt.user && (dt.user._id || dt.user._openid)) };
    });
    out.mine = m;
    console.log('[mine]', JSON.stringify(m));
    chk('「我的」头像失败已回退默认头像', !!(m && m.avatarErr === true), `avatarErr=${m && m.avatarErr}`);
    try { await mp.screenshot({ path: path.join(__dirname, '_fb_mine.png') }); } catch (e) {}
    const log2 = await drain(mp);
    allErrs.push(...log2.filter(l => l.lvl === 'error'));

    // 3) 首页：卡片应回退占位图（goods-card 自带）
    await mp.switchTab('/pages/index/index');
    await wait(9000);
    const h = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p && p.route, listLen: ((p && p.data.list) || []).length };
    });
    out.home = h;
    chk('首页卡片渲染正常', !!(h && h.route === 'pages/index/index' && h.listLen > 0), `${h && h.listLen} 条`);
    try { await mp.screenshot({ path: path.join(__dirname, '_fb_index.png') }); } catch (e) {}
    const log3 = await drain(mp);
    allErrs.push(...log3.filter(l => l.lvl === 'error'));

    chk('调试器无 JS 报错', allErrs.length === 0,
      allErrs.length ? `${allErrs.length} 条：${String(allErrs[0].msg).slice(0, 100)}` : '0 条');
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
