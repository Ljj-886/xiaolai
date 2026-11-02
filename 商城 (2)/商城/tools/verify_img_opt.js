// tools/verify_img_opt.js —— 验证 imageMogr2 图片处理已生效：URL 带处理参数 + 实际下载体积大幅下降
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
function probe(mp, urls) {
  return evalSafe(mp, (urls) => new Promise(resolve => {
    const results = []; let i = 0;
    const next = () => {
      if (i >= urls.length) return resolve(results);
      const u = urls[i++];
      wx.request({
        url: u, method: 'GET', responseType: 'text',
        success: r => {
          const ct = (r.header && (r.header['Content-Type'] || r.header['content-type'])) || '';
          const body = typeof r.data === 'string' ? r.data : '';
          results.push({ code: r.statusCode, ct, kb: Math.round(body.length / 1024 * 10) / 10 });
          next();
        },
        fail: e => { results.push({ fail: String(e && e.errMsg || e) }); next(); }
      });
    };
    next();
  }), urls);
}

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // ---- 1) 首页列表：cover 必须带 imageMogr2，且体积远小于原图 ----
    const gl = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const list = (gl.data && gl.data.list) || [];
    const covers = list.map(g => g.cover).filter(Boolean);
    out.rawCoverSample = covers[0];
    chk('goods.list 返回', list.length > 0, `${list.length} 条`);
    chk('列表 cover 均带 imageMogr2', covers.length > 0 && covers.every(c => String(c).indexOf('imageMogr2') >= 0),
      `${covers.filter(c => String(c).indexOf('imageMogr2') >= 0).length}/${covers.length} 带参数`);
    const pl = await probe(mp, covers.slice(0, 5));
    out.listProbe = pl;
    const listKb = pl.filter(x => x.kb).map(x => x.kb);
    const maxKb = listKb.length ? Math.max(...listKb) : -1;
    chk('列表封面实际下载体积 < 150KB', listKb.length > 0 && maxKb < 150,
      `样本 ${listKb.join('/')} KB（最大 ${maxKb}KB，原图 4287KB）`);

    // ---- 2) 详情：cover + images 也必须带参数 ----
    if (list.length) {
      const gd = await callCF(mp, 'goods', { action: 'detail', id: list[0]._id });
      const d = gd && gd.data || {};
      const urls = [d.cover].concat(d.images || []).filter(Boolean);
      chk('详情图均带 imageMogr2', urls.length > 0 && urls.every(u => String(u).indexOf('imageMogr2') >= 0),
        `${urls.length} 张`);
      const pd = await probe(mp, urls.slice(0, 5));
      out.detailProbe = pd;
      const kb = pd.filter(x => x.kb).map(x => x.kb);
      chk('详情图实际下载体积 < 300KB', kb.length > 0 && Math.max(...kb) < 300, `${kb.join('/')} KB`);
    }

    // ---- 3) 我的商品 ----
    const mg = await callCF(mp, 'user', { action: 'myGoods', page: 1, pageSize: 20, status: 'onSale' });
    const ml = (mg.data && mg.data.list) || [];
    const mc = ml.map(g => g.cover).filter(Boolean);
    chk('myGoods cover 均带 imageMogr2', mc.length > 0 && mc.every(c => String(c).indexOf('imageMogr2') >= 0),
      `${mc.filter(c => String(c).indexOf('imageMogr2') >= 0).length}/${mc.length} 带参数`);

    // ---- 4) 我的收藏 ----
    const mf = await callCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 20 });
    const fl = (mf.data && mf.data.list) || [];
    const fc = fl.map(g => g.cover).filter(Boolean);
    chk('myFavs cover 均带 imageMogr2（无收藏时跳过）', fc.length === 0 || fc.every(c => String(c).indexOf('imageMogr2') >= 0),
      `${fc.filter(c => String(c).indexOf('imageMogr2') >= 0).length}/${fc.length} 带参数`);

    // ---- 5) 页面截图 ----
    await mp.reLaunch('/pages/index/index');
    await wait(9000);
    try { await mp.screenshot({ path: path.join(__dirname, '_opt_index.png') }); out.shotIndex = true; } catch (e) { out.shotIndex = String(e.message); }
    await mp.reLaunch('/pages/sold/sold?status=onSale');
    await wait(9000);
    try { await mp.screenshot({ path: path.join(__dirname, '_opt_sold.png') }); out.shotSold = true; } catch (e) { out.shotSold = String(e.message); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
