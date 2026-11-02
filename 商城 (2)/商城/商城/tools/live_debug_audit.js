// tools/live_debug_audit.js
// 接手 IDE：遍历所有页面，抓取调试器 console 错误/警告（含页面脚本错误），按页面归因。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

function evalSafe(mp, fn, ...a) {
  const p = mp.evaluate(fn, ...a).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
}
async function injectOrReset(mp) {
  await evalSafe(mp, () => {
    try {
      if (!globalThis.__errs) {
        globalThis.__errs = [];
        globalThis.__warns = [];
        const oe = console.error, ow = console.warn;
        console.error = function () {
          try { globalThis.__errs.push(Array.prototype.map.call(arguments, a => (a && a.stack) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 500)); } catch (e) {}
          return oe.apply(console, arguments);
        };
        console.warn = function () {
          try { globalThis.__warns.push(Array.prototype.map.call(arguments, a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 300)); } catch (e) {}
          return ow.apply(console, arguments);
        };
        if (typeof wx !== 'undefined' && !wx.__onerrorHooked) {
          wx.__onerrorHooked = true;
          const pe = wx.onError;
        }
      } else {
        globalThis.__errs = [];
        globalThis.__warns = [];
      }
    } catch (e) {}
    return true;
  });
}
async function readErrs(mp) {
  const r = await evalSafe(mp, () => ({ e: globalThis.__errs || [], w: globalThis.__warns || [] }));
  if (r && r.__timeout) return { e: [], w: [] };
  if (r && r.__evalErr) return { e: ['[collector error] ' + r.__evalErr], w: [] };
  return { e: r.e || [], w: r.w || [] };
}
async function reLaunch(mp, url) {
  return evalSafe(mp, u => new Promise(res => {
    wx.reLaunch({ url: u, success: () => res('ok'), fail: e => res('fail:' + (e && e.errMsg || e)) });
  }), url);
}

// 页面清单（带参数的页用 dummy id，错误多为「找不到」属预期，单独标注）
const PAGES = [
  ['index', '/pages/index/index', false],
  ['category', '/pages/category/category', false],
  ['publish', '/pages/publish/publish', false],
  ['chat', '/pages/chat/chat', false],
  ['mine', '/pages/mine/mine', false],
  ['detail', '/pages/detail/detail?id=dummy000', true],
  ['search', '/pages/search/search', false],
  ['verify', '/pages/verify/verify', false],
  ['login', '/pages/login/login', false],
  ['order', '/pages/order/order', false],
  ['order-detail', '/pages/order-detail/order-detail?id=dummy000', true],
  ['chatroom', '/pages/chatroom/chatroom?id=dummy000', true],
  ['favorite', '/pages/favorite/favorite', false],
  ['pickup', '/pages/pickup/pickup', false],
  ['review', '/pages/review/review?orderId=dummy000', true],
  ['report', '/pages/report/report?target=dummy000&type=goods', true],
  ['admin', '/pages/admin/admin', false],
  ['edit-profile', '/pages/edit-profile/edit-profile', false],
  ['feedback', '/pages/feedback/feedback', false],
  ['sold', '/pages/sold/sold', false],
  ['credit', '/pages/credit/credit', false],
  ['agreement', '/pages/agreement/agreement', false],
  ['privacy', '/pages/privacy/privacy', false],
  ['admin-goods', '/pages/admin-goods/admin-goods?tab=pending', false],
  ['admin-users', '/pages/admin-users/admin-users', false],
  ['admin-reviews', '/pages/admin-reviews/admin-reviews?tab=feedback', false]
];

(async () => {
  const result = { perPage: {}, summary: { errors: 0, warns: 0, badPages: [] } };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    console.log('[connect] ok');
    await wait(3000);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await evalSafe(mp, () => { try { globalThis.__p = (wx.getSystemInfoSync && wx.getSystemInfoSync().model) || 'ok'; } catch (e) {} return 'ok'; });
    await wait(1000);
    await injectOrReset(mp);

    for (const [name, url, param] of PAGES) {
      await injectOrReset(mp); // 重置收集器
      const nav = await reLaunch(mp, url);
      await wait(1100);
      const { e, w } = await readErrs(mp);
      result.perPage[name] = { nav, errors: e, warns: w, paramPage: param };
      if (e.length) { result.summary.errors += e.length; result.summary.badPages.push(name); }
      result.summary.warns += w.length;
      process.stdout.write(`  ${e.length ? '❌' : '✅'} ${name}  err=${e.length} warn=${w.length}\n`);
    }
  } catch (e) {
    console.error('[fatal]', e && e.stack || e);
    result.fatal = String(e && e.stack || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== DEBUG AUDIT =====');
  console.log(JSON.stringify(result, null, 2));
})();
