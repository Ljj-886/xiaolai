// tools/probe_imgprocess.js —— 验证云存储下载 URL 能否直接挂 imageMogr2 图片处理参数
// 若能：只需在云函数生成 URL 时追加后缀，即可让渲染层拿到 1080px 小图，零迁移成本
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
  const out = { tests: [] };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 取一个有超大图的 fileID
    const all = await callCF(mp, 'admin', { action: 'listGoods', status: 'all', page: 1, pageSize: 100 });
    const gl = (all.data && all.data.list) || [];
    const fids = [...new Set(gl.map(g => g.cover).filter(Boolean))];
    const urlRes = await evalSafe(mp, (fids) => new Promise(resolve => {
      wx.cloud.getTempFileURL({ fileList: fids, success: r => resolve(r.fileList || []), fail: e => resolve({ __fail: String(e && e.errMsg || e) }) });
    }), fids);
    const base = ((Array.isArray(urlRes) ? urlRes : [])[0] || {}).tempFileURL;
    out.baseUrl = base;
    if (!base) { out.err = '拿不到临时 URL'; }

    // 候选后缀（COS 图片处理；参数不在签名列表内时应可被网关接受）
    const suffixes = [
      { name: '原图(基线)', suffix: '' },
      { name: 'imageMogr2 thumbnail1080 jpg q80', suffix: '&imageMogr2/thumbnail/1080x/format/jpg/quality/80' },
      { name: 'imageMogr2 thumbnail750 jpg q75', suffix: '&imageMogr2/thumbnail/750x/format/jpg/quality/75' },
      { name: 'imageMogr2 (问号写法)', suffix: '?imageMogr2/thumbnail/1080x/format/jpg/quality/80' },
      { name: 'imageslim 瘦身', suffix: '&imageslim' }
    ];

    const probe = await evalSafe(mp, (urls) => new Promise(resolve => {
      const results = [];
      let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(results);
        const it = urls[i++];
        wx.request({
          url: it.url, method: 'GET', responseType: 'text',
          success: r => {
            const ct = (r.header && (r.header['Content-Type'] || r.header['content-type'])) || '';
            const body = typeof r.data === 'string' ? r.data : '';
            const isImg = /^image\//.test(ct) || body.charCodeAt(0) === 0xFFFD || /PNG|JFIF|Exif/.test(body.slice(0, 40));
            results.push({ name: it.name, code: r.statusCode, ct, len: body.length, isImg, head: body.slice(0, 40).replace(/[^\x20-\x7e]/g, '.') });
            next();
          },
          fail: e => { results.push({ name: it.name, fail: String(e && e.errMsg || e) }); next(); }
        });
      };
      next();
    }), suffixes.map(s => ({ name: s.name, url: s.suffix.startsWith('?') ? base.split('?')[0] + s.suffix : base + s.suffix })));

    out.tests = probe;
    console.log('[imageMogr2 probe]');
    if (Array.isArray(probe)) {
      probe.forEach(p => {
        const kb = p.len ? (p.len / 1024).toFixed(1) + 'KB' : '-';
        console.log(`  ${p.code || 'ERR'} ct=${p.ct || '-'} size=${kb} isImg=${p.isImg} | ${p.name} ${p.fail || ''}`);
      });
    } else console.log('  ' + JSON.stringify(probe));
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
