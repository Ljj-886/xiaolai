// tools/verify_img_render.js —— 关键实验：渲染层能否解码带 imageMogr2 参数的 URL
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

(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    const gl = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const covers = (((gl.data && gl.data.list) || []).map(g => g.cover).filter(Boolean)).slice(0, 4);
    out.covers = covers;

    // A) 渲染层解码测试：wx.getImageInfo（与 <image> 同一解码链路）
    out.getImageInfo = await evalSafe(mp, (urls) => new Promise(resolve => {
      const r = []; let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(r);
        const u = urls[i++];
        wx.getImageInfo({ src: u,
          success: v => { r.push({ ok: true, w: v.width, h: v.height, type: v.type }); next(); },
          fail: e => { r.push({ ok: false, err: String(e && e.errMsg || e) }); next(); } });
      };
      next();
    }), covers);
    console.log('[wx.getImageInfo on imageMogr2 URLs]');
    if (Array.isArray(out.getImageInfo)) out.getImageInfo.forEach((x, i) => console.log(`  ${i} ${JSON.stringify(x)}`));

    // B) 对照：去掉 imageMogr2 的原始 URL 是否可解码
    const plain = covers.map(u => String(u).split('&imageMogr2')[0]);
    out.getImageInfoPlain = await evalSafe(mp, (urls) => new Promise(resolve => {
      const r = []; let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(r);
        const u = urls[i++];
        wx.getImageInfo({ src: u,
          success: v => { r.push({ ok: true, w: v.width, h: v.height }); next(); },
          fail: e => { r.push({ ok: false, err: String(e && e.errMsg || e) }); next(); } });
      };
      next();
    }), plain);
    console.log('[wx.getImageInfo on 原始 URL(无参数)]');
    if (Array.isArray(out.getImageInfoPlain)) out.getImageInfoPlain.forEach((x, i) => console.log(`  ${i} ${JSON.stringify(x)}`));

    // C) 页面加载 + 分阶段截图
    await mp.reLaunch('/pages/index/index');
    await wait(5000);
    try { await mp.screenshot({ path: path.join(__dirname, '_r_index_5s.png') }); out.shot5 = true; } catch (e) { out.shot5 = String(e.message); }
    await wait(15000);
    try { await mp.screenshot({ path: path.join(__dirname, '_r_index_20s.png') }); out.shot20 = true; } catch (e) { out.shot20 = String(e.message); }
    out.pageState = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.list) || [];
      return { route: p && p.route, len: l.length, loading: p && p.data.loading, firstCover: l[0] ? String(l[0].cover).slice(-60) : '' };
    });
    console.log('[page]', JSON.stringify(out.pageState));

    // D) 通过页面 data 直接改一张图为原始 URL，看渲染层是否显示（对照）
    //    用 setData 把 list[0].cover 换成无参数版本，观察截图差异
    await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p.data.list || []).slice();
      if (l[0]) { l[0] = Object.assign({}, l[0], { cover: String(l[0].cover).split('&imageMogr2')[0] }); p.setData({ list: l }); }
      return true;
    });
    await wait(6000);
    try { await mp.screenshot({ path: path.join(__dirname, '_r_index_plain_first.png') }); out.shotPlain = true; } catch (e) { out.shotPlain = String(e.message); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
