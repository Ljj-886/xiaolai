// tools/verify_jpeg.js —— 验证「离屏 canvas → 导出 JPEG」机制可用，并走一遍 publish 的 _reencodeJpeg
const automator = require('miniprogram-automator');
const PROJECT = require('path').join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
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

    // 进发布页（拿到 _reencodeJpeg 方法）
    await mp.switchTab('/pages/publish/publish');
    await wait(4500);

    // 造一张「随机噪点」PNG：随机数据几乎无法压缩，体积必然 > 800KB，
    // 能稳定触发 _compress 的「转 JPEG」分支（且是最不利于 JPEG 的极端样本）。
    const made = await evalSafe(mp, () => new Promise(resolve => {
      if (!wx.createOffscreenCanvas) return resolve({ err: '不支持 createOffscreenCanvas' });
      const W = 1200, H = 800;
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(W, H);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.floor(Math.random() * 256);
        d[i + 1] = Math.floor(Math.random() * 256);
        d[i + 2] = Math.floor(Math.random() * 256);
        d[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      wx.canvasToTempFilePath({
        canvas, fileType: 'png', destWidth: W, destHeight: H,
        success: r => resolve({ path: r.tempFilePath || r.filePath || '' }),
        fail: e => resolve({ err: 'canvasToTempFilePath(png) 失败 ' + String(e && e.errMsg || e) })
      });
    }));
    out.made = made;
    chk('离屏 canvas 可导出 PNG（模拟大图）', !!(made && made.path), (made && (made.path || made.err)) || '');
    if (!made || !made.path) throw new Error('造图失败，无法继续');

    const sizeOf = p => evalSafe(mp, (p) => new Promise(resolve => {
      wx.getFileInfo({ filePath: p, success: r => resolve(Number(r.size) || 0), fail: () => resolve(-1) });
    }), p);
    const pngSize = await sizeOf(made.path);
    out.pngSize = pngSize;
    console.log(`   模拟 PNG 体积：${Math.round(pngSize / 1024)} KB`);

    // 2) 走 publish 的 _reencodeJpeg
    const after = await evalSafe(mp, (p) => new Promise(resolve => {
      const page = getCurrentPages().slice(-1)[0];
      if (typeof page._reencodeJpeg !== 'function') return resolve({ err: '页面没有 _reencodeJpeg' });
      Promise.resolve(page._reencodeJpeg(p)).then(r => resolve({ path: r }));
    }), made.path);
    out.after = after;
    chk('publish._reencodeJpeg 可调用且返回路径', !!(after && after.path), (after && (after.path || after.err)) || '');

    if (after && after.path) {
      const jpgSize = await sizeOf(after.path);
      out.jpgSize = jpgSize;
      const beforeKb = Math.round(pngSize / 1024), afterKb = Math.round(jpgSize / 1024);
      const changed = after.path !== made.path;
      // 注意：这里是「最不利于 JPEG」的随机噪点样本，JPEG 变大是正常且可接受的，
      // 关键安全属性由下一步 _compress 的「取更小者」保证。
      out.jpegVsPng = { beforeKb, afterKb, changed };
      console.log(`   JPEG 对比：${beforeKb} KB → ${afterKb} KB（${changed ? '已生成新文件' : '回退到原文件'}）`);
    }

    // 2b) 关键安全属性：_compress 的结果**绝不能比输入更大**（内部会取更小者）
    const comp = await evalSafe(mp, (p) => new Promise(resolve => {
      const page = getCurrentPages().slice(-1)[0];
      if (typeof page._compress !== 'function') return resolve({ err: '页面没有 _compress' });
      Promise.resolve(page._compress(p)).then(r => resolve({ path: r }));
    }), made.path);
    out.comp = comp;
    chk('publish._compress 可调用并返回路径', !!(comp && comp.path), (comp && (comp.path || comp.err)) || '');
    if (comp && comp.path) {
      const cSize = await sizeOf(comp.path);
      out.compSize = cSize;
      const inKb = Math.round(pngSize / 1024), outKb = Math.round(cSize / 1024);
      chk('_compress 结果不会比输入更大（取更小者）', cSize > 0 && cSize <= pngSize,
        `输入 ${inKb} KB → 输出 ${outKb} KB`);
    }

    // 3) 失败兜底：传一个不存在的路径，应回退而不是抛错
    const bad = await evalSafe(mp, () => new Promise(resolve => {
      const page = getCurrentPages().slice(-1)[0];
      Promise.resolve(page._reencodeJpeg('/__not_exist__.png')).then(r => resolve({ path: r }));
    }));
    chk('异常输入时回退原路径（不阻断发布）', !!(bad && bad.path === '/__not_exist__.png'), JSON.stringify(bad));
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
