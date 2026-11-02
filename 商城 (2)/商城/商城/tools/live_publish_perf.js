// 真机复测 publish 链路（上传1x1 png + publish + 删除），耗时 + 返回码。

const path = require('path');
const Automator = require('miniprogram-automator');

(async () => {
  const projectPath = path.join(__dirname, '..');
  const mp = await Automator.connect({
    wsEndpoint: 'ws://127.0.0.1:29602',
    projectPath,
    cwd: projectPath,
    timeout: 30000
  });
  console.log('已连接。');

  const r = await mp.evaluate(async () => {
    const log = [];
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI2/0NAAAAAElFTkSuQmCC';
    // upload
    const t1 = Date.now();
    const ab = wx.base64ToArrayBuffer(base64);
    const fsm = wx.getFileSystemManager();
    const local = `${wx.env.USER_DATA_PATH}/pub_perf_${Date.now()}.png`;
    fsm.writeFileSync(local, ab, 'binary');
    const fileID = await new Promise((resolve, reject) => {
      wx.cloud.uploadFile({ cloudPath: `goods/perf/perf_${Date.now()}.png`, filePath: local, success: r => resolve(r.fileID), fail: reject });
    });
    log.push('upload', Date.now() - t1);
    // publish
    const t2 = Date.now();
    let pubErr = null, newId = null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'goods',
        data: {
          action: 'publish',
          title: '性能诊断' + Date.now(),
          desc: '',
          images: [fileID],
          price: '1',
          originalPrice: '',
          category: 'other',
          condition: 'normal',
          pickupPoint: '',
          type: 'sell'
        }
      });
      if (res.result && res.result.code === 0) newId = res.result.data && res.result.data._id;
      else pubErr = { code: res.result && res.result.code, msg: res.result && res.result.msg };
    } catch (e) {
      pubErr = { errCode: e.errCode, errMsg: (e.errMsg || e.message || '').slice(0, 200) };
    }
    log.push('publish', Date.now() - t2);
    // remove
    const t3 = Date.now();
    let remErr = null;
    if (newId) {
      try {
        const res = await wx.cloud.callFunction({ name: 'goods', data: { action: 'remove', id: newId } });
        if (!(res.result && res.result.code === 0)) remErr = { code: res.result && res.result.code, msg: res.result && res.result.msg };
      } catch (e) { remErr = { errCode: e.errCode, errMsg: (e.errMsg || e.message || '').slice(0, 200) }; }
    }
    log.push('remove', Date.now() - t3);
    return { log, fileID, newId, pubErr, remErr };
  });
  console.log(JSON.stringify(r, null, 2));

  const ok = !r.pubErr && !r.remErr && r.newId;
  console.log(ok ? '✅ publish 链路 OK，耗时细节：' : '❌ publish 链路失败：');
  for (let i = 0; i < r.log.length; i += 2) console.log(`  - ${r.log[i]}: ${r.log[i + 1]}ms`);

  await mp.close();
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
