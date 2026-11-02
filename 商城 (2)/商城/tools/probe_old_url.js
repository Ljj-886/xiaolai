// tools/probe_old_url.js —— 验证 SWR 缓存里的「旧临时图链」是否已失效（这是图片裂图的真凶）
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

    // 1) 读出首页 SWR 缓存里的 cover（旧临时链接）
    out.cache = await evalSafe(mp, () => {
      const c = wx.getStorageSync('cm_home_list_v1') || {};
      const list = Array.isArray(c.list) ? c.list : [];
      return {
        at: c.at, ageMin: c.at ? Math.round((Date.now() - c.at) / 60000) : null,
        count: list.length,
        covers: list.map(x => x.cover).filter(Boolean)
      };
    });
    console.log('[cache]', JSON.stringify({ at: out.cache.at, ageMin: out.cache.ageMin, count: out.cache.count }, null, 2));

    // 2) 直接请求这些旧 URL，看状态码
    const oldUrls = (out.cache.covers || []).slice(0, 5);
    const probeOld = await evalSafe(mp, (urls) => new Promise(resolve => {
      const r = []; let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(r);
        const u = urls[i++];
        wx.request({ url: u, method: 'GET', responseType: 'text',
          success: x => { const b = typeof x.data === 'string' ? x.data : ''; r.push({ code: x.statusCode, kb: Math.round(b.length / 1024 * 10) / 10, t: (u.match(/[?&]t=(\d+)/) || [])[1] }); next(); },
          fail: e => { r.push({ fail: String(e && e.errMsg || e) }); next(); } });
      };
      next();
    }), oldUrls);
    out.probeOld = probeOld;
    console.log('[旧 URL 请求结果]');
    if (Array.isArray(probeOld)) probeOld.forEach((x, i) => console.log(`  ${i} ${JSON.stringify(x)}  age(s)=${x.t ? Math.round(Date.now() / 1000 - Number(x.t)) : '-'}`));

    // 3) 对照：新拉一次 goods.list（新临时链接），同样请求
    const gl = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const fresh = (((gl.data && gl.data.list) || []).map(g => g.cover).filter(Boolean)).slice(0, 3);
    const probeNew = await evalSafe(mp, (urls) => new Promise(resolve => {
      const r = []; let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(r);
        const u = urls[i++];
        wx.request({ url: u, method: 'GET', responseType: 'text',
          success: x => { const b = typeof x.data === 'string' ? x.data : ''; r.push({ code: x.statusCode, kb: Math.round(b.length / 1024 * 10) / 10, t: (u.match(/[?&]t=(\d+)/) || [])[1] }); next(); },
          fail: e => { r.push({ fail: String(e && e.errMsg || e) }); next(); } });
      };
      next();
    }), fresh);
    out.probeNew = probeNew;
    console.log('[新 URL 请求结果]');
    if (Array.isArray(probeNew)) probeNew.forEach((x, i) => console.log(`  ${i} ${JSON.stringify(x)}  age(s)=${x.t ? Math.round(Date.now() / 1000 - Number(x.t)) : '-'}`));

    out.nowSec = Math.floor(Date.now() / 1000);
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
