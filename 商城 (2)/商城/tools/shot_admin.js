// tools/shot_admin.js —— 抓管理后台商品管理/举报页截图，确认缩略图与凭证图已恢复
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
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 商品管理：切到「全部」→ 数据最全，截图
    await mp.reLaunch('/pages/admin-goods');
    await wait(9000);
    await wait(3000);
    out.all = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.list) || [];
      return { route: p && p.route, active: p && p.data.active, len: l.length, covers: l.map(g => (g.cover ? String(g.cover).slice(0, 44) : '(空)')) };
    });
    console.log('[admin-goods all]', JSON.stringify({ active: out.all.active, len: out.all.len }));
    try { await mp.screenshot({ path: path.join(__dirname, '_adm_all.png') }); out.shotAll = true; } catch (e) { out.shotAll = String(e.message); }

    // 举报页
    await mp.reLaunch('/pages/admin-reviews');
    await wait(9000);
    out.reviews = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p && p.route, tab: p && p.data.tab, reportCount: ((p && p.data.reports) || []).length };
    });
    console.log('[admin-reviews]', JSON.stringify(out.reviews));
    try { await mp.screenshot({ path: path.join(__dirname, '_adm_reviews.png') }); out.shotReviews = true; } catch (e) { out.shotReviews = String(e.message); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
