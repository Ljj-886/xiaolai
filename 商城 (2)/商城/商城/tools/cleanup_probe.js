// tools/cleanup_probe.js —— 清理探针上传到云存储的测试文件
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2000);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    const ENV = 'cloud1-d6gxmdbcqf5d51f3e.636c-cloud1-d6gxmdbcqf5d51f3e-1479199796';
    const ids = ['arrears_probe_1789321975862.jpg'];
    const fileList = ids.map(n => `cloud://${ENV}/probe/${n}`);
    const r = await evalSafe(mp, (fileList) => new Promise(resolve => {
      wx.cloud.deleteFile({ fileList,
        success: x => resolve({ ok: true, list: (x.fileList || []).map(f => ({ id: String(f.fileID).split('/').pop(), status: f.status, errMsg: f.errMsg })) }),
        fail: e => resolve({ ok: false, err: String((e && (e.errMsg || e.message)) || e) }) });
    }), fileList);
    console.log('删除探针文件结果：', JSON.stringify(r));
    console.log('（注：删除本身也可能受停服影响；若仍残留，恢复账号后可手动清理 /probe/ 目录）');
  } catch (e) {
    console.log('异常：' + String((e && e.message) || e));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
