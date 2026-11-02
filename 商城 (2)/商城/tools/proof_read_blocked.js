// tools/proof_read_blocked.js —— 决定性验证：上传一个全新文件并立刻读回
// 若「刚上传的新文件」也读不出来 ⇒ 与 URL 过期、imageMogr2 参数、前端代码全部无关，
// 是云存储的「读取」被账号级停用。
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

    // ① 造一张小图并上传（全新文件，URL 一定是全新的、参数最干净）
    const up = await evalSafe(mp, () => new Promise(resolve => {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 32, height: 32 });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e33'; ctx.fillRect(0, 0, 32, 32);
      wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: 0.8, destWidth: 32, destHeight: 32,
        success: r => wx.cloud.uploadFile({
          cloudPath: 'probe/readblock_' + Date.now() + '.jpg',
          filePath: r.tempFilePath,
          success: x => resolve({ ok: true, fileID: x.fileID }),
          fail: e => resolve({ ok: false, stage: 'upload', err: String((e && (e.errMsg || e.message)) || e) })
        }),
        fail: e => resolve({ ok: false, stage: 'canvas', err: String(e && e.errMsg || e) }) });
    }));
    console.log('① 上传全新文件: ' + JSON.stringify(up).slice(0, 220));
    if (!up || !up.ok) { console.log('上传都失败了，说明停服已影响写入'); return; }
    fileID = up.fileID;

    // ② 换临时链接
    const turl = await evalSafe(mp, (fid) => new Promise(resolve => {
      wx.cloud.getTempFileURL({ fileList: [fid],
        success: r => { const it = (r.fileList || [])[0] || {}; resolve({ status: it.status, url: it.tempFileURL }); },
        fail: e => resolve({ err: String((e && e.errMsg) || e) }) });
    }), fileID);
    console.log('② 换临时链接: ' + JSON.stringify(turl).slice(0, 220));

    // ③ 立刻读这个「全新、最干净」的链接
    const get = await evalSafe(mp, (url) => new Promise(resolve => {
      if (!url) return resolve({ skip: true });
      wx.request({ url, method: 'GET', responseType: 'text',
        success: x => resolve({ code: x.statusCode, body: String(x.data || '').replace(/\s+/g, ' ').slice(0, 200) }),
        fail: e => resolve({ fail: String(e && e.errMsg || e) }) });
    }), turl && turl.url);
    console.log('③ HTTP GET 全新链接: ' + JSON.stringify(get).slice(0, 260));

    // ④ 走 SDK 的下载通道（绕过 HTTP 缓存/CDN，验证是否同样不可用）
    const dl = await evalSafe(mp, (fid) => new Promise(resolve => {
      wx.cloud.downloadFile({ fileID: fid,
        success: x => resolve({ ok: true, path: String(x.tempFilePath || '').slice(0, 40) }),
        fail: e => resolve({ ok: false, err: String((e && (e.errMsg || e.message)) || e).slice(0, 220) }) });
    }), fileID);
    console.log('④ SDK downloadFile: ' + JSON.stringify(dl).slice(0, 260));

    console.log('\n===== 结论 =====');
    if (up.ok && get.code !== 200 && (!dl || !dl.ok)) {
      console.log('✅ 判定：**云存储「读取」被账号级停用**');
      console.log('   依据：刚上传的全新文件、用最干净的链接、连 SDK 下载通道都取不到 ⇒');
      console.log('   与「URL 过期 / imageMogr2 参数 / 前端代码」完全无关。');
      console.log('   修复只能靠结清欠费（充值），代码无法绕过。');
    } else if (get.code === 200) {
      console.log('⚠️ 读取已恢复（HTTP 200）—— 若页面仍是默认图，则需排查前端缓存/重渲染。');
    }
  } catch (e) {
    console.log('异常：' + String((e && e.message) || e).slice(0, 200));
  } finally {
    if (mp && fileID) {
      try {
        const d = await evalSafe(mp, (fid) => new Promise(resolve => {
          wx.cloud.deleteFile({ fileList: [fid], success: () => resolve('已删除'), fail: e => resolve('删除失败 ' + String(e && e.errMsg || e).slice(0, 60)) });
        }), fileID);
        console.log('⑤ 清理探针文件: ' + d);
      } catch (e) {}
    }
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
