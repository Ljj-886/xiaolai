// tools/live_debug_focus2.js —— 用 getCurrentPages() 路由确认真实加载后再读错误（规避 reLaunch 返回超时假阳性）。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...a) {
  const p = mp.evaluate(fn, ...a).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 15000))]);
}
function routeOf(url) { // '/pages/favorite/favorite?id=x' -> 'pages/favorite/favorite'
  return url.replace(/^\//, '').split('?')[0];
}
async function resetCollector(mp) {
  await evalSafe(mp, () => {
    try {
      if (!globalThis.__errs) {
        globalThis.__errs = []; globalThis.__warns = [];
        const oe = console.error, ow = console.warn;
        console.error = function () { try { globalThis.__errs.push(Array.prototype.map.call(arguments, a => (a && a.stack) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 500)); } catch (e) {} return oe.apply(console, arguments); };
        console.warn = function () { try { globalThis.__warns.push(Array.prototype.map.call(arguments, a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 300)); } catch (e) {} return ow.apply(console, arguments); };
      } else { globalThis.__errs = []; globalThis.__warns = []; }
    } catch (e) {}
    return true;
  });
}
async function curRoute(mp) {
  const r = await evalSafe(mp, () => { try { const ps = getCurrentPages(); return ps.length ? ps[ps.length - 1].route : ''; } catch (e) { return ''; } });
  return (r && typeof r === 'string') ? r : '';
}
async function readErrs(mp) {
  const r = await evalSafe(mp, () => ({ e: globalThis.__errs || [], w: globalThis.__warns || [] }));
  if (r && !r.__timeout && !r.__evalErr) return { e: r.e || [], w: r.w || [] };
  return { e: ['[read failed]'], w: [] };
}
async function ensurePage(mp, url) {
  const want = routeOf(url);
  for (let i = 0; i < 5; i++) {
    await evalSafe(mp, u => new Promise(res => { wx.reLaunch({ url: u, success: () => res(1), fail: () => res(0) }); }), url);
    await wait(700);
    const rt = await curRoute(mp);
    if (rt === want) return true;
    await wait(600);
  }
  return false;
}

const ARG = process.argv[2];
const PAGES = ARG
  ? ARG.split(',').map(s => { const [n, u] = s.split('|'); return [n, u]; })
  : [
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
      const ok = await ensurePage(mp, url);
      await wait(1300); // 等页面 onLoad 异步报错
      const { e, w } = await readErrs(mp);
      const realErrs = (e.length === 1 && e[0] === '[read failed]') ? [] : e;
      result.perPage[name] = { loaded: ok, errors: realErrs, warns: w };
      if (realErrs.length) { result.summary.errors += realErrs.length; result.summary.bad.push(name); }
      result.summary.warns += w.length;
      process.stdout.write(`  ${realErrs.length ? '❌' : '✅'} ${name}  loaded=${ok} err=${realErrs.length} warn=${w.length}\n`);
    }
  } catch (e) {
    console.error('[fatal]', e && e.stack || e);
    result.fatal = String(e && e.stack || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== FOCUS2 AUDIT =====');
  console.log(JSON.stringify(result, null, 2));
})();
