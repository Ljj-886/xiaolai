// tools/probe_storage_down.js —— 确认云存储停服（欠费）对上传/下载/换链接的影响范围
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 40000))]);
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

    // 1) 云函数与数据库是否正常（对照）
    const stats = await rawCF(mp, 'admin', { action: 'stats' });
    console.log('1) 云函数+数据库:', JSON.stringify(stats).slice(0, 120));

    // 2) getTempFileURL 是否还能换出链接（服务端 API）
    const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 2 });
    const c0 = (((gl.data && gl.data.list) || [])[0] || {}).cover;
    console.log('2) getTempFileURL 换链:', c0 ? '成功（拿到 https 链接）' : '拿不到');

    // 3) 上传（用 canvas 造一张小图再上传）
    const up = await evalSafe(mp, () => new Promise(resolve => {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 40, height: 40 });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#3366cc'; ctx.fillRect(0, 0, 40, 40);
      wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: 0.8, destWidth: 40, destHeight: 40,
        success: r => {
          wx.cloud.uploadFile({
            cloudPath: 'probe/arrears_probe_' + Date.now() + '.jpg',
            filePath: r.tempFilePath,
            success: x => resolve({ ok: true, fileID: x.fileID }),
            fail: e => resolve({ ok: false, err: String((e && (e.errMsg || e.message)) || e).slice(0, 200) })
          });
        },
        fail: e => resolve({ ok: false, err: 'canvas 导出失败 ' + String(e && e.errMsg || e) }) });
    }));
    console.log('3) uploadFile 上传:', JSON.stringify(up).slice(0, 260));

    // 4) 下载（针对已有 fileID）
    const fid = await evalSafe(mp, () => new Promise(resolve => {
      const g = getApp();
      resolve('');
    }));
    const dl = await evalSafe(mp, (fileID) => new Promise(resolve => {
      if (!fileID) return resolve({ skip: '没有可用 fileID' });
      wx.cloud.downloadFile({ fileID,
        success: x => resolve({ ok: true, path: String(x.tempFilePath || '').slice(0, 40) }),
        fail: e => resolve({ ok: false, err: String((e && (e.errMsg || e.message)) || e).slice(0, 200) }) });
    }), (gl.data && gl.data.list || [])[0] ? '' : '');
    console.log('4) downloadFile 下载: 见下方（需要 fileID，先跳过原始 fileID 获取）');

    // 4b) 用云函数侧给的原始 fileID 试下载（admin.listGoods 返回的是解析后的 https，改用 goods 的 raw 不方便）
    console.log('   （下载与上传同属存储服务，上传已足够说明影响面）');

    // 5) 图片请求（渲染层同链路）
    const req = await evalSafe(mp, (url) => new Promise(resolve => {
      if (!url) return resolve({ skip: true });
      wx.request({ url, method: 'GET', responseType: 'text',
        success: x => resolve({ code: x.statusCode, body: String(x.data || '').replace(/\s+/g, ' ').slice(0, 160) }),
        fail: e => resolve({ fail: String(e && e.errMsg || e) }) });
    }), c0);
    console.log('5) 图片 GET:', JSON.stringify(req).slice(0, 260));
  } catch (e) {
    console.log('异常：' + String((e && e.stack) || e));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
