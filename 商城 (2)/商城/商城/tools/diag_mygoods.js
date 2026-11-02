// tools/diag_mygoods.js —— 坐实「我的商品」页与详情页图片形态 + 截图
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
const pfx = v => !v ? '(空)' : String(v).slice(0, 40);

(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 我的商品页
    await mp.reLaunch('/pages/sold/sold?status=onSale');
    await wait(9000);
    try { await mp.screenshot({ path: path.join(__dirname, '_mg_sold.png') }); out.shotSold = true; } catch (e) { out.shotSold = String(e.message); }
    out.sold = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.list) || [];
      return {
        route: p && p.route, listLen: l.length, loading: p && p.data.loading,
        covers: l.map(g => (g.cover ? String(g.cover).slice(0, 34) : '(空)'))
      };
    });
    console.log('[sold]', JSON.stringify(out.sold));

    // 2) 详情页（取一个在售商品）
    const gl = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const first = ((gl.data && gl.data.list) || [])[0];
    if (first && first._id) {
      await mp.reLaunch('/pages/detail/detail?id=' + first._id);
      await wait(4500);
      try { await mp.screenshot({ path: path.join(__dirname, '_mg_detail.png') }); out.shotDetail = true; } catch (e) { out.shotDetail = String(e.message); }
      out.detail = await evalSafe(mp, () => {
        const p = getCurrentPages().slice(-1)[0];
        const g = (p && p.data.goods) || (p && p.data.item) || {};
        const s = v => (!v ? '(空)' : String(v).slice(0, 40));
        return { route: p && p.route, cover: s(g.cover), img0: s((g.images || [])[0]), imgs: (g.images || []).length };
      });
      console.log('[detail]', JSON.stringify(out.detail));
    } else {
      out.detail = '无在售商品';
    }
    out.ctx = { firstId: first && first._id };
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
