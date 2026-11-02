// tools/diag_images.js —— 诊断「图片不见了」：抓取真实返回的 cover/images 形态 + 页面截图
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
const pfx = v => !v ? '(空)' : String(v).slice(0, 34);

(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 首页列表：cover / images 形态
    const gl = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const list = (gl.data && gl.data.list) || [];
    out.goodsList = list.map((g, i) => ({
      i, id: String(g._id).slice(-6), status: g.status,
      cover: pfx(g.cover), imgs: (g.images || []).length, img0: pfx((g.images || [])[0])
    }));
    console.log('[goods.list]');
    out.goodsList.forEach(r => console.log(`  #${r.i} ${r.id} st=${r.status} cover=${r.cover} imgs=${r.imgs} img0=${r.img0}`));

    // 2) 我的商品（sold / 在售）
    const mg = await callCF(mp, 'user', { action: 'myGoods', page: 1, pageSize: 20, status: 'onSale' });
    const ml = (mg.data && mg.data.list) || [];
    out.myGoods = ml.map((g, i) => ({ i, id: String(g._id).slice(-6), status: g.status, cover: pfx(g.cover), imgs: (g.images || []).length }));
    console.log('[user.myGoods onSale]');
    out.myGoods.forEach(r => console.log(`  #${r.i} ${r.id} st=${r.status} cover=${r.cover} imgs=${r.imgs}`));

    // 3) 首页截图
    await evalSafe(mp, () => new Promise(res => wx.reLaunch({ url: '/pages/index/index', complete: () => res('ok') })));
    await wait(3500);
    try { await mp.screenshot({ path: path.join(__dirname, '_img_index.png') }); out.shotIndex = true; } catch (e) { out.shotIndex = String(e.message); }
    const idx = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const c = ((p && p.data.list && p.data.list[0]) || {}).cover || '';
      return { route: p && p.route, listLen: (p && p.data.list || []).length, loading: p && p.data.loading, loadError: p && p.data.loadError, firstCover: c ? String(c).slice(0, 34) : '(空)' };
    });
    out.indexPage = idx;
    console.log('[index page]', JSON.stringify(idx));

    // 4) 我的商品页截图
    await evalSafe(mp, () => new Promise(res => wx.reLaunch({ url: '/pages/sold/sold?status=onSale', complete: () => res('ok') })));
    await wait(3000);
    try { await mp.screenshot({ path: path.join(__dirname, '_img_sold.png') }); out.shotSold = true; } catch (e) { out.shotSold = String(e.message); }
    const sp = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.list) || [];
      const c = (l[0] || {}).cover || '';
      return { route: p && p.route, listLen: l.length, firstCover: c ? String(c).slice(0, 34) : '(空)' };
    });
    out.soldPage = sp;
    console.log('[sold page]', JSON.stringify(sp));
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
