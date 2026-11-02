// tools/verify_unfav.js —— 验证「我的收藏」页快捷取消收藏（用临时收藏，验完还原）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp, gid = null;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 记录现有收藏，挑一个不在收藏里的商品临时加入（保证不动用户真实收藏）
    const f0 = await rawCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 50 });
    const before = ((f0.data && f0.data.list) || []).map(g => g._id);
    const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const cand = ((gl.data && gl.data.list) || []).find(g => before.indexOf(g._id) < 0);
    if (!cand) { chk('准备临时收藏', false, '没有可用于测试的商品'); }
    else {
      gid = cand._id;
      const t1 = await rawCF(mp, 'user', { action: 'toggleFav', goodsId: gid });
      const f1 = await rawCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 50 });
      const added = ((f1.data && f1.data.list) || []).some(g => g._id === gid);
      chk('准备临时收藏成功', t1.code === 0 && added, `${String(gid).slice(-6)} 已在收藏列表`);

      // 2) 进收藏页，确认列表里有它，且按钮存在
      await mp.reLaunch('/pages/favorite/favorite');
      await wait(8000);
      const st = await evalSafe(mp, () => {
        const p = getCurrentPages().slice(-1)[0];
        const l = (p && p.data.list) || [];
        return { route: p && p.route, len: l.length, hasTarget: l.some(x => x._id === (window.__gid || '')) };
      });
      // 用 setData 无关方式：直接把 gid 传进页面上下文再比对
      const st2 = await evalSafe(mp, (gid) => {
        const p = getCurrentPages().slice(-1)[0];
        const l = (p && p.data.list) || [];
        return { route: p && p.route, len: l.length, hasTarget: l.some(x => x._id === gid) };
      }, gid);
      out.favPage = st2;
      chk('收藏页加载正常且含目标商品', st2 && st2.route === 'pages/favorite/favorite' && st2.hasTarget,
        `${st2 && st2.len} 条，含测试商品=${st2 && st2.hasTarget}`);
      //（截图统一放到所有断言之后，避免 mp.screenshot 干扰 IDE 页面栈）

      // 3) 调页面的 unfav（等价于点「取消收藏」按钮）
      const called = await evalSafe(mp, (gid) => {
        const p = getCurrentPages().slice(-1)[0];
        if (typeof p.unfav !== 'function') return { err: '页面没有 unfav 方法' };
        p.unfav({ currentTarget: { dataset: { id: gid } } });
        return { ok: true };
      }, gid);
      chk('页面存在 unfav 方法并可调用', !!(called && called.ok), JSON.stringify(called));
      await wait(4000);

      const after = await evalSafe(mp, (gid) => {
        const p = getCurrentPages().slice(-1)[0];
        const stack = (getCurrentPages() || []).map(x => x && x.route);
        const l = (p && p.data.list) || [];
        return {
          route: p && p.route, stack,
          len: l.length, hasTarget: l.some(x => x._id === gid),
          titles: l.slice(0, 6).map(x => String(x.title || '').slice(0, 8))
        };
      }, gid);
      out.afterState = after;
      console.log('[unfav 后页面状态]', JSON.stringify(after));
      chk('本地列表已移除（乐观更新）', after && after.route === 'pages/favorite/favorite' && !after.hasTarget,
        `route=${after && after.route} 剩余 ${after && after.len} 条，仍含目标=${after && after.hasTarget}`);

      // 4) 服务端也确实取消了
      const f2 = await rawCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 50 });
      const still = ((f2.data && f2.data.list) || []).some(g => g._id === gid);
      const now = ((f2.data && f2.data.list) || []).map(g => g._id);
      chk('服务端收藏已取消', !still, `服务端仍含=${still}`);

      // 5) 状态还原：现有收藏应与初始一致
      const restored = before.length === now.length && before.every(id => now.indexOf(id) >= 0);
      chk('用户原有收藏未被破坏（状态还原）', restored, `初始 ${before.length} 条 → 现在 ${now.length} 条`);

      // 所有断言完成后再截图（mp.screenshot 会干扰 IDE 页面栈，不能夹在断言之间）
      try { await mp.screenshot({ path: path.join(__dirname, '_uf_favorite.png') }); out.shot = true; }
      catch (e) { out.shot = String(e && e.message || e); }
    }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    // 兜底：若测试商品仍在收藏里则移除
    if (mp && gid) {
      try {
        const f = await rawCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 50 });
        if (((f.data && f.data.list) || []).some(g => g._id === gid)) {
          await rawCF(mp, 'user', { action: 'toggleFav', goodsId: gid });
          console.log('[兜底清理] 已移除残留测试收藏');
        }
      } catch (e) {}
      try { await mp.close(); } catch (e) {}
    } else if (mp) { try { await mp.close(); } catch (e) {} }
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
