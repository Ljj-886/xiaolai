// tools/diag_fav_nav.js —— 对照实验：收藏页 reLaunch 后不做任何操作，看页面栈会不会自己变
const automator = require('miniprogram-automator');
const PROJECT = require('path').join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
}
const snap = mp => evalSafe(mp, () => {
  const st = (getCurrentPages() || []).map(x => x && x.route);
  const p = getCurrentPages().slice(-1)[0];
  return { stack: st, route: p && p.route, len: ((p && p.data.list) || []).length };
});

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    await mp.reLaunch('/pages/favorite/favorite');
    for (const t of [4000, 4000, 4000, 4000]) {
      await wait(t);
      const s = await snap(mp);
      console.log(`+${t}ms →`, JSON.stringify(s));
    }
    console.log('\n结论：若上面 route 一直是 pages/favorite/favorite，说明收藏页不会自己跳走，');
    console.log('     那 verify_unfav 里跳回首页就是调用 unfav 触发的（需继续查）；否则是页面自身问题。');
  } catch (e) {
    console.log('异常：' + String((e && e.stack) || e));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
