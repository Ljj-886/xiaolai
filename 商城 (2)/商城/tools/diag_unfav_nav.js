// tools/diag_unfav_nav.js —— 二分定位「取消收藏后跳回首页」：分别只做 setData / 只发请求，观察页面栈
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
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 造一个临时收藏，保证列表里至少有它
    const f0 = await rawCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 50 });
    const before = ((f0.data && f0.data.list) || []).map(g => g._id);
    const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const cand = ((gl.data && gl.data.list) || []).find(g => before.indexOf(g._id) < 0);
    if (!cand) { console.log('没有可用测试商品'); return; }
    const gid = cand._id;
    await rawCF(mp, 'user', { action: 'toggleFav', goodsId: gid });
    console.log('已造临时收藏', String(gid).slice(-6));

    await mp.reLaunch('/pages/favorite/favorite');
    await wait(7000);
    console.log('A. 初始           →', JSON.stringify(await snap(mp)));

    // B. 只做本地 setData（移除该项）
    await evalSafe(mp, (gid) => {
      const p = getCurrentPages().slice(-1)[0];
      p.setData({ list: p.data.list.filter(x => x._id !== gid) });
      return true;
    }, gid);
    await wait(4000);
    console.log('B. 仅 setData 后  →', JSON.stringify(await snap(mp)));

    // C. 只发云请求（toggleFav），不改本地
    const r = await rawCF(mp, 'user', { action: 'toggleFav', goodsId: gid });
    await wait(4000);
    console.log('C. 仅云端请求后   →', JSON.stringify(await snap(mp)), 'toggleFav=', JSON.stringify(r).slice(0, 60));

    // 还原：把临时收藏加回来再走一次完整 unfav 观察
    await rawCF(mp, 'user', { action: 'toggleFav', goodsId: gid }); // 确保处于已收藏
    await wait(1500);
    const s1 = await snap(mp);
    console.log('D. 恢复收藏后     →', JSON.stringify(s1));
    await evalSafe(mp, (gid) => {
      const p = getCurrentPages().slice(-1)[0];
      if (typeof p.unfav === 'function') p.unfav({ currentTarget: { dataset: { id: gid } } });
      return true;
    }, gid);
    await wait(4500);
    console.log('E. 完整 unfav 后  →', JSON.stringify(await snap(mp)));

    // 清理
    const f2 = await rawCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 50 });
    if (((f2.data && f2.data.list) || []).some(g => g._id === gid)) {
      await rawCF(mp, 'user', { action: 'toggleFav', goodsId: gid });
      console.log('[清理] 已移除残留');
    }
  } catch (e) {
    console.log('异常：' + String((e && e.stack) || e));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
