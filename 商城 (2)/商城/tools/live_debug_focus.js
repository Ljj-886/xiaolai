// tools/live_debug_focus.js —— 聚焦复检指定页面，导航带重试，确保真正加载后读错误。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...a) {
  const p = mp.evaluate(fn, ...a).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 18000))]);
}
async function resetCollector(mp) {
  await evalSafe(mp, () => {
    try {
      if (!globalThis.__errs) {
        globalThis.__errs = []; globalThis.__warns = [];
        const oe = console.error, ow = console.warn;
        console.error = function () { try { globalThis.__errs.push(Array.prototype.map.call(arguments, a => (a && a.stack) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 500)); } catch (e) {} return oe.apply(console, arguments); };
        console.warn = function () { try { globalThis.__warns.push(Array.prototype.map.call(arguments, a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 300)); } catch (e) {} return ow.apply(console, arguments); };
        if (typeof wx !== 'undefined' && wx.onError && !wx.__oeHooked) { wx.__oeHooked = true; const f = wx.onError; wx.onError = function (e) { try { globalThis.__errs.push('[onError] ' + (e && (e.message || e.stack) || e)); } catch (x) {} return f && f.apply(wx, arguments); }; }
      } else { globalThis.__errs = []; globalThis.__warns = []; }
    } catch (e) {}
    return true;
  });
}
async function readErrs(mp) {
  for (let i = 0; i < 3; i++) {
    const r = await evalSafe(mp, () => ({ e: globalThis.__errs || [], w: globalThis.__warns || [] }));
    if (r && !r.__timeout && !r.__evalErr) return { e: r.e || [], w: r.w || [] };
    await wait(800);
  }
  return { e: ['[read failed]'], w: [] };
}
async function navWithRetry(mp, url) {
  for (let i = 0; i < 3; i++) {
    const r = await evalSafe(mp, u => new Promise(res => {
      wx.reLaunch({ url: u, success: () => res('ok'), fail: e => res('fail:' + (e && e.errMsg || e)) });
    }), url);
    if (r === 'ok') return 'ok';
    await wait(1000);
  }
  return 'retry-failed';
}

const PAGES = [
  ['favorite', '/pages/favorite/favorite'],
  ['pickup', '/pages/pickup/pickup'],
  ['edit-profile', '/pages/edit-profile/edit-profile'],
  ['feedback', '/pages/feedback/feedback'],
  ['sold', '/pages/sold/sold'],
  ['credit', '/pages/credit/credit'],
  ['agreement', '/pages/agreement/agreement'],
  ['privacy', '/pages/privacy/privacy'],
  ['admin', '/pages/admin/admin'],
  ['admin-goods', '/pages/admin-goods/admin-goods?tab=pending'],
  ['admin-users', '/pages/admin-users/admin-users'],
  ['admin-reviews', '/pages/admin-reviews/admin-reviews?tab=feedback']
];

(async () => {
  const result = { perPage: {}, summary: { errors: 0, warns: 0, bad: [] } };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    console.log('[connect] ok');
    await wait(3000);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await evalSafe(mp, () => { try { globalThis.__p = 'ok'; } catch (e) {} return 'ok'; });
    await wait(1000);
    await resetCollector(mp);

    for (const [name, url] of PAGES) {
      await resetCollector(mp);
      const nav = await navWithRetry(mp, url);
      await wait(1200);
      const { e, w } = await readErrs(mp);
      result.perPage[name] = { nav, errors: e, warns: w };
      if (e.length && !(e.length === 1 && e[0] === '[read failed]')) { result.summary.errors += e.length; result.summary.bad.push(name); }
      result.summary.warns += w.length;
      process.stdout.write(`  ${e.length ? '❌' : '✅'} ${name}  nav=${nav} err=${e.length} warn=${w.length}\n`);
    }
  } catch (e) {
    console.error('[fatal]', e && e.stack || e);
    result.fatal = String(e && e.stack || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== FOCUS AUDIT =====');
  console.log(JSON.stringify(result, null, 2));
})();
