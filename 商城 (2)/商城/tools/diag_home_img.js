// tools/diag_home_img.js —— 首页图片不显示：确认现象 + 拿到 goods-card 内部真实 src
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
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 接口层：cover 是否正常（带 imageMogr2、可加载）
    const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 5 });
    const list = (gl.data && gl.data.list) || [];
    console.log('[接口] goods.list 条数 =', list.length);
    list.forEach((g, i) => {
      const c = String(g.cover || '');
      console.log(`  #${i} ${String(g._id).slice(-6)} cover前60=${c.slice(0, 60)} 带Mogr2=${c.indexOf('imageMogr2') >= 0}`);
    });
    const covers = list.map(g => g.cover).filter(Boolean);
    const probe = await evalSafe(mp, (urls) => new Promise(resolve => {
      const r = []; let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(r);
        const u = urls[i++];
        wx.request({ url: u, method: 'GET', responseType: 'text',
          success: x => { const b = typeof x.data === 'string' ? x.data : ''; r.push({ code: x.statusCode, kb: Math.round(b.length / 1024 * 10) / 10 }); next(); },
          fail: e => { r.push({ fail: String(e && e.errMsg || e) }); next(); } });
      };
      next();
    }), covers.slice(0, 5));
    console.log('[接口] 封面请求结果 =', JSON.stringify(probe));

    // 2) 渲染层：打开首页，读 goods-card 内部真实 imgSrc / item
    await mp.switchTab('/pages/index/index');
    await wait(9000);
    const inner = await evalSafe(mp, () => new Promise(resolve => {
      const q = wx.createSelectorQuery();
      // 逐个 goods-card 组件实例查询内部的 image
      q.selectAll('goods-card').fields({ node: true, size: true, dataset: true, id: true, rect: true }, res => resolve(res));
      q.exec();
    }));
    console.log('[组件查询] goods-card 数量 =', Array.isArray(inner) ? inner.length : JSON.stringify(inner).slice(0, 120));

    const imgs = await evalSafe(mp, () => new Promise(resolve => {
      const q = wx.createSelectorQuery();
      q.selectAll('image.gc-img').fields({ node: true, dataset: true, size: true, rect: true }, res => resolve(res));
      q.exec();
    }));
    console.log('[页面级 image.gc-img] =', Array.isArray(imgs) ? imgs.length : JSON.stringify(imgs).slice(0, 120));

    // 3) 页面数据里的 cover（用来对比渲染层）
    const pageCovers = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.list) || [];
      return { len: l.length, covers: l.map(x => String(x.cover || '').slice(0, 50)), ids: l.map(x => String(x._id).slice(-6)) };
    });
    console.log('[页面数据] =', JSON.stringify(pageCovers, null, 1).slice(0, 500));

    try { await mp.screenshot({ path: path.join(__dirname, '_hi_index.png') }); console.log('[截图] 已保存 _hi_index.png'); }
    catch (e) { console.log('[截图失败]', String(e && e.message || e)); }
  } catch (e) {
    console.log('异常：' + String((e && e.stack) || e));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
