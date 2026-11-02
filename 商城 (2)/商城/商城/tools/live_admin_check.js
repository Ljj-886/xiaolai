// tools/live_admin_check.js
// 快速确认管理后台子页（已售商品 / 举报归档）能正常加载并取到数据
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
}
async function reLaunch(mp, url) {
  return evalSafe(mp, u => new Promise(res => {
    wx.reLaunch({ url: u, success: () => res('ok'), fail: e => res('fail:' + (e && e.errMsg || e)) });
  }), url);
}
(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    await reLaunch(mp, '/pages/admin-goods/admin-goods?tab=sold'); await wait(2500);
    out.adminGoodsSold = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const list = (p && p.data.list) || [];
      return {
        route: p && p.route, active: p && p.data.active,
        count: list.length,
        allSold: list.every(g => g.status === 'sold'),
        statuses: [...new Set(list.map(g => g.status))]
      };
    });
    console.log('[admin-goods sold]', JSON.stringify(out.adminGoodsSold));

    await reLaunch(mp, '/pages/admin-reviews/admin-reviews?tab=report'); await wait(2000);
    out.adminReviewsReport = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p && p.route, active: p && p.data.active, archive: p && p.data.archive, count: (p && p.data.list || []).length };
    });
    console.log('[admin-reviews report]', JSON.stringify(out.adminReviewsReport));

    await reLaunch(mp, '/pages/admin-reviews/admin-reviews?tab=verify'); await wait(1500);
    out.adminReviewsVerify = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p && p.route, active: p && p.data.active };
    });
    console.log('[admin-reviews verify]', JSON.stringify(out.adminReviewsVerify));
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
