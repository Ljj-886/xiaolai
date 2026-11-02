// tools/probe_maxage.js —— 决定性验证 getTempFileURL 的 maxAge 是否真的控制有效期
// 手法：同一个 fileID 分别用 maxAge=1（1秒）与 maxAge=86400（1天）取链接，
//       等待 10s 再请求：若 maxAge 生效，短链接应 403，长链接应 200。
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

    // 拿一个真实 fileID
    const all = await callCF(mp, 'admin', { action: 'listGoods', status: 'all', page: 1, pageSize: 5 });
    const fid = (((all.data && all.data.list) || [])[0] || {}).cover;
    out.fileID = fid;
    if (!fid) { out.err = '拿不到 fileID'; }

    // 三种取法
    const urls = await evalSafe(mp, (fid) => new Promise(resolve => {
      const pick = (fl, tag) => new Promise(res => {
        wx.cloud.getTempFileURL({ fileList: fl,
          success: r => { const it = (r.fileList || [])[0] || {}; res({ tag, url: it.tempFileURL, status: it.status, maxAge: it.maxAge }); },
          fail: e => res({ tag, fail: String(e && e.errMsg || e) }) });
      });
      Promise.all([
        pick([fid], 'default(字符串)'),
        pick([{ fileID: fid, maxAge: 1 }], 'maxAge=1'),
        pick([{ fileID: fid, maxAge: 86400 }], 'maxAge=86400')
      ]).then(resolve);
    }), fid);
    out.urls = urls;
    console.log('[取到的链接]');
    (Array.isArray(urls) ? urls : []).forEach(u => console.log(`  ${u.tag} status=${u.status} maxAge=${u.maxAge} fail=${u.fail || ''}\n    ${u.url || ''}`));

    const list = (Array.isArray(urls) ? urls : []).filter(u => u.url);

    const probe = (when) => evalSafe(mp, (urls) => new Promise(resolve => {
      const r = []; let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(r);
        const u = urls[i++];
        wx.request({ url: u.url, method: 'GET', responseType: 'text',
          success: x => { const b = typeof x.data === 'string' ? x.data : ''; r.push({ tag: u.tag, code: x.statusCode, kb: Math.round(b.length / 1024 * 10) / 10 }); next(); },
          fail: e => { r.push({ tag: u.tag, fail: String(e && e.errMsg || e) }); next(); } });
      };
      next();
    }), list);

    out.probeImmediate = await probe();
    console.log('[立即请求]');
    (out.probeImmediate || []).forEach(p => console.log(`  ${p.tag}: code=${p.code} ${p.kb || ''}KB ${p.fail || ''}`));

    await wait(12000);
    out.probeAfter12s = await probe();
    console.log('[等待 12s 后再请求]');
    (out.probeAfter12s || []).forEach(p => console.log(`  ${p.tag}: code=${p.code} ${p.kb || ''}KB ${p.fail || ''}`));
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
