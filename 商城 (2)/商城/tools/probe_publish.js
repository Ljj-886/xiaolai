// 验证用户痛点：goods.publish 是否还超时（-504003）
// 关键：publish 内部同步调 seccheck 云函数，若 seccheck 未部署/慢会直接拖垮 publish
const path = require('path');
const Automator = require('miniprogram-automator');
const projectPath = path.join(__dirname, '..');

(async () => {
  const mp = await Automator.connect({
    wsEndpoint: 'ws://localhost:9420', projectPath, cwd: projectPath, timeout: 30000
  });
  console.log('✅ connected\n');

  // 1. seccheck 是否已部署 + 耗时
  const sec = await mp.evaluate(() => new Promise(resolve => {
    const t0 = Date.now();
    const timer = setTimeout(() => resolve({ dt: Date.now() - t0, err: 'TIMEOUT_15S' }), 15000);
    wx.cloud.callFunction({ name: 'seccheck', data: { action: 'text', content: '测试商品标题' } })
      .then(r => {
        clearTimeout(timer);
        resolve({ dt: Date.now() - t0, code: r.result && r.result.code, msg: r.result && r.result.msg ? String(r.result.msg).slice(0, 80) : '', data: r.result && r.result.data });
      })
      .catch(e => {
        clearTimeout(timer);
        resolve({ dt: Date.now() - t0, errCode: e && e.errCode, errMsg: String((e && (e.errMsg || e.message)) || '').slice(0, 140) });
      });
  }));
  console.log('1) seccheck.text:', JSON.stringify(sec));

  // 2. 上传测试图
  const up = await mp.evaluate(() => new Promise(resolve => {
    const t0 = Date.now();
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI2/0NAAAAAElFTkSuQmCC';
    const ab = wx.base64ToArrayBuffer(b64);
    const fsm = wx.getFileSystemManager();
    const local = `${wx.env.USER_DATA_PATH}/probe_${Date.now()}.png`;
    fsm.writeFileSync(local, ab, 'binary');
    wx.cloud.uploadFile({
      cloudPath: `goods/probe/probe_${Date.now()}.png`, filePath: local,
      success: r => resolve({ dt: Date.now() - t0, fileID: r.fileID }),
      fail: e => resolve({ dt: Date.now() - t0, err: String(e && e.errMsg || e) })
    });
  }));
  console.log('2) uploadFile:', JSON.stringify(up).slice(0, 160));

  // 3. publish 测耗时
  let pub = { skipped: 'no fileID' };
  if (up.fileID) {
    pub = await mp.evaluate(fileID => new Promise(resolve => {
      const t0 = Date.now();
      const timer = setTimeout(() => resolve({ dt: Date.now() - t0, err: 'TIMEOUT_25S' }), 25000);
      wx.cloud.callFunction({
        name: 'goods',
        data: {
          action: 'publish',
          title: '自动化探针' + Date.now(),
          desc: '', images: [fileID], price: '1', originalPrice: '',
          category: 'other', condition: 'normal', pickupPoint: '', type: 'sell'
        }
      })
        .then(r => {
          clearTimeout(timer);
          const rs = r && r.result;
          resolve({ dt: Date.now() - t0, code: rs && rs.code, msg: rs && rs.msg ? String(rs.msg).slice(0, 100) : '', id: rs && rs.data && rs.data._id });
        })
        .catch(e => {
          clearTimeout(timer);
          resolve({ dt: Date.now() - t0, errCode: e && e.errCode, errMsg: String((e && (e.errMsg || e.message)) || '').slice(0, 160) });
        });
    }), up.fileID);
  }
  console.log('3) goods.publish:', JSON.stringify(pub));

  // 4. 清理测试商品
  if (pub.id) {
    const del = await mp.evaluate(id => new Promise(resolve => {
      wx.cloud.callFunction({ name: 'goods', data: { action: 'remove', id } })
        .then(r => resolve({ code: r.result && r.result.code }))
        .catch(e => resolve({ err: String(e && e.errMsg || e).slice(0, 80) }));
    }), pub.id);
    console.log('4) cleanup remove:', JSON.stringify(del));
  }

  console.log('\n=== 结论 ===');
  if (pub.dt != null && pub.dt > 3000) console.log(`⚠️ publish 耗时 ${pub.dt}ms（偏慢，有超时风险）`);
  else if (pub.code === 0) console.log(`✅ publish 耗时 ${pub.dt}ms，成功`);
  else console.log(`❌ publish 失败: ${pub.msg || pub.errMsg || JSON.stringify(pub)}`);

  await mp.close();
  console.log('done.');
})().catch(e => { console.error('FATAL', e && (e.message || e)); process.exit(1); });
