// tools/probe_cloudimg.js —— 关键实验：https 被 451 时，能否用云文件 ID 直接渲染图片？
// 背景：实测 HTTP/CDN 读取返回 451（账号欠费），但 wx.cloud.downloadFile 仍可下载成功。
// 小程序 <image> 官方支持直接传云文件 ID（cloud://）——若可行，则是当前故障下的合法可用路径。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 40000))]);
}

(async () => {
  let mp, fileID = null;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2000);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 准备一个测试文件（上传新文件，链接唯一干净）
    const up = await evalSafe(mp, () => new Promise(resolve => {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 64, height: 64 });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#2b7'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#fff'; ctx.fillRect(16, 16, 32, 32);
      wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: 0.8, destWidth: 64, destHeight: 64,
        success: r => wx.cloud.uploadFile({
          cloudPath: 'probe/cloudimg_' + Date.now() + '.jpg', filePath: r.tempFilePath,
          success: x => resolve({ ok: true, fileID: x.fileID }),
          fail: e => resolve({ ok: false, err: 'upload ' + String((e && (e.errMsg || e.message)) || e) }) }),
        fail: e => resolve({ ok: false, err: 'canvas ' + String(e && e.errMsg || e) }) });
    }));
    console.log('准备文件: ' + JSON.stringify(up).slice(0, 180));
    if (!up || !up.ok) return;
    fileID = up.fileID;

    // A) wx.getImageInfo 直接吃 cloud:// 文件ID（与 <image> 同一条解析链路）
    const a = await evalSafe(mp, (fid) => new Promise(resolve => {
      wx.getImageInfo({ src: fid,
        success: v => resolve({ ok: true, w: v.width, h: v.height, type: v.type, path: String(v.path || '').slice(0, 40) }),
        fail: e => resolve({ ok: false, err: String((e && (e.errMsg || e.message)) || e).slice(0, 200) }) });
    }), fileID);
    console.log('A) getImageInfo(cloud://) : ' + JSON.stringify(a));

    // B) SDK 下载到本地临时文件后再解码
    const b = await evalSafe(mp, (fid) => new Promise(resolve => {
      wx.cloud.downloadFile({ fileID: fid,
        success: x => {
          wx.getImageInfo({ src: x.tempFilePath,
            success: v => resolve({ ok: true, w: v.width, h: v.height, local: String(x.tempFilePath).slice(0, 30) }),
            fail: e => resolve({ ok: false, err: '已下载但解码失败 ' + String(e && e.errMsg || e).slice(0, 120) }) });
        },
        fail: e => resolve({ ok: false, err: 'download ' + String((e && (e.errMsg || e.message)) || e).slice(0, 160) }) });
    }), fileID);
    console.log('B) downloadFile→getImageInfo : ' + JSON.stringify(b));

    // C) 对照：https 链接（当前 451）
    const turl = await evalSafe(mp, (fid) => new Promise(resolve => {
      wx.cloud.getTempFileURL({ fileList: [fid], success: r => resolve(((r.fileList || [])[0] || {}).tempFileURL), fail: () => resolve('') });
    }), fileID);
    const c = await evalSafe(mp, (url) => new Promise(resolve => {
      if (!url) return resolve({ skip: true });
      wx.getImageInfo({ src: url,
        success: v => resolve({ ok: true, w: v.width, h: v.height }),
        fail: e => resolve({ ok: false, err: String((e && (e.errMsg || e.message)) || e).slice(0, 160) }) });
    }), turl);
    console.log('C) getImageInfo(https 链接) : ' + JSON.stringify(c));

    console.log('\n===== 判定 =====');
    if (a && a.ok) {
      console.log('✅ 结论：**cloud:// 文件ID 可以直接解码渲染** —— 这是当前 http 读取被停用时，');
      console.log('   小程序侧仍然可用的合法路径（<image src="cloud://..."> 是官方支持用法）。');
      console.log('   可据此做「https 失败 → 回退 cloud://」的兜底，让图片在欠费期间也能显示。');
    } else if (b && b.ok) {
      console.log('⚠️ cloud:// 不能直接解码，但 downloadFile→本地路径 可以。');
      console.log('   可行方案：图片加载失败时用 downloadFile 取本地文件再渲染（成本略高）。');
    } else {
      console.log('❌ 两条通道都不可用，只能等结清欠费。');
    }
  } catch (e) {
    console.log('异常：' + String((e && e.message) || e).slice(0, 200));
  } finally {
    if (mp && fileID) {
      try {
        await evalSafe(mp, (fid) => new Promise(resolve => {
          wx.cloud.deleteFile({ fileList: [fid], success: () => resolve(1), fail: () => resolve(0) });
        }), fileID);
        console.log('探针文件已清理');
      } catch (e) {}
    }
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
