// tools/diag_img_load.js —— 定位「图片 URL 解析成功但渲染层加载失败」
// 思路：拿原始 cloud:// fileID → getTempFileURL → 实际 wx.request 该 URL，看状态码/内容类型/体积
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

    // 1) 拿原始 fileID（admin.listGoods 返回未解析的 cloud://）
    const all = await callCF(mp, 'admin', { action: 'listGoods', status: 'all', page: 1, pageSize: 100 });
    const gl = (all.data && all.data.list) || [];
    out.goodsCount = gl.length;
    const rawCovers = [];
    gl.forEach(g => {
      if (g.cover) rawCovers.push({ id: String(g._id).slice(-6), status: g.status, cover: g.cover, images: (g.images || []).slice(0, 3) });
    });
    // 去重 fileID
    const uniq = [...new Set(rawCovers.map(x => x.cover).filter(Boolean))];
    out.uniqCovers = uniq.length;

    // 打印原始 fileID，检查是否有空格/异常字符
    console.log('[raw fileIDs]');
    uniq.forEach((f, i) => {
      const tail = String(f).split('/').pop();
      console.log(`  ${i} len=${String(f).length} hasSpace=${/\s/.test(f)} tail=${JSON.stringify(tail)}`);
    });
    out.fileIdSample = uniq.slice(0, 10).map(f => ({ full: f, tail: String(f).split('/').pop(), hasSpace: /\s/.test(String(f)) }));

    // 2) 换成临时 https URL
    const urlRes = await evalSafe(mp, (fids) => new Promise(resolve => {
      wx.cloud.getTempFileURL({ fileList: fids, success: r => resolve(r.fileList || []), fail: e => resolve({ __fail: String(e && e.errMsg || e) }) });
    }), uniq);
    const urlList = Array.isArray(urlRes) ? urlRes : [];
    out.urlCount = urlList.length;
    out.urlSample = urlList.slice(0, 10).map(it => ({ fileID: it.fileID, status: it.status, url: it.tempFileURL }));

    // 3) 实际请求每个 URL，记录状态码 / 内容类型 / 体积
    const urls = urlList.map(it => it.tempFileURL).filter(Boolean);
    const probe = await evalSafe(mp, (urls) => new Promise(resolve => {
      const results = [];
      let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(results);
        const u = urls[i++];
        wx.request({
          url: u, method: 'GET', responseType: 'text',
          success: r => {
            const ct = (r.header && (r.header['Content-Type'] || r.header['content-type'])) || '';
            const body = typeof r.data === 'string' ? r.data : '';
            results.push({ ok: r.statusCode === 200, code: r.statusCode, ct, len: body.length, head: body.slice(0, 90) });
            next();
          },
          fail: e => { results.push({ ok: false, fail: String(e && e.errMsg || e) }); next(); }
        });
      };
      next();
    }), urls);

    out.probes = Array.isArray(probe) ? probe : probe;
    const fails = Array.isArray(probe) ? probe.filter(p => !p.ok) : [];
    out.probeTotal = Array.isArray(probe) ? probe.length : 0;
    out.probeFail = fails.length;
    console.log('\n[probe results]');
    if (Array.isArray(probe)) {
      probe.forEach((p, i) => console.log(`  ${i} ok=${p.ok} code=${p.code} ct=${p.ct} len=${p.len} ${p.fail || ''} ${p.head ? JSON.stringify(p.head.slice(0, 60)) : ''}`));
    } else {
      console.log('  ' + JSON.stringify(probe));
    }

    // 4) 用 wx.getImageInfo 直接问渲染层能不能解码
    const imgInfo = await evalSafe(mp, (urls) => new Promise(resolve => {
      const results = [];
      let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(results);
        const u = urls[i++];
        wx.getImageInfo({
          src: u,
          success: r => { results.push({ ok: true, w: r.width, h: r.height, type: r.type }); next(); },
          fail: e => { results.push({ ok: false, err: String(e && e.errMsg || e) }); next(); }
        });
      };
      next();
    }), urls);
    out.imageInfo = imgInfo;
    console.log('\n[wx.getImageInfo]');
    if (Array.isArray(imgInfo)) imgInfo.forEach((x, i) => console.log(`  ${i} ${JSON.stringify(x)}`));
    else console.log('  ' + JSON.stringify(imgInfo));
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
