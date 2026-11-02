// tools/live_publish_diagnose.js
// 真机综合诊断：升级后 cloud.js 的 err 处理精准度 + publish 链路是否真能跑通。
// 策略：把 utils/cloud.js 函数体直接注入 mp.evaluate 作为函数体，暴露到 globalThis 复用
//       （绕开 mp.evaluate 里 eval/require 都不可用的问题）。
// 用法：node tools/live_publish_diagnose.js

const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  await mp.disconnect();
  mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  console.log('✅ 已重连\n');

  await mp.evaluate(() => wx.reLaunch({ url: '/pages/index/index' }));
  await sleep(2500);

  // 把 cloud.js 源码（去掉 module.exports）注入运行时，暴露 call 到 globalThis
  const cloudSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'cloud.js'), 'utf8');
  const fnSrc = `async function() {
    ${cloudSrc.replace(/module\.exports\s*=\s*\{[^}]*\};?/m, 'globalThis.__cloudCall = { call };')}
  }`;
  await mp.evaluate(fnSrc);
  console.log('✅ 已注入新版 cloud.js 到运行时 globalThis.__cloudCall\n');

  // —— A. fake_func_xyz（应精准显示「未部署」）——
  const a = await mp.evaluate(async () => {
    try {
      const e = await globalThis.__cloudCall.call('fake_func_xyz', { action: 'noop' }).catch(x => x);
      return { code: e && e.code, msg: e && e.msg };
    } catch (e) { return { thrown: String(e && (e.message || e)) }; }
  });
  console.log('A. fake_func_xyz →', JSON.stringify(a));
  const aOk = a.msg && a.msg.indexOf('未部署') !== -1;
  console.log(`   ${aOk ? '✅' : '❌'} ${aOk ? '走「未部署」分支（不再误判为网络异常）' : '仍漏判'}\n`);

  // —— B. publish 不带图（then.reject 路径，业务消息）——
  const b = await mp.evaluate(async () => {
    try {
      const e = await globalThis.__cloudCall.call('goods', {
        action: 'publish', title: '诊断' + Date.now(), desc: '', images: [],
        price: '1', category: 'book', condition: 'normal', pickupPoint: '', type: 'sell'
      }).catch(x => x);
      return { code: e && e.code, msg: e && e.msg };
    } catch (e) { return { thrown: String(e && (e.message || e)) }; }
  });
  console.log('B. publish 不带图 →', JSON.stringify(b));
  const bOk = b.msg && b.msg.indexOf('至少上传一张图') !== -1;
  console.log(`   ${bOk ? '✅' : '❌'} 业务提示精准\n`);

  // —— C. 真上传 1x1 png + publish + 删除（用户痛点）——
  const c = await mp.evaluate(async () => {
    try {
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI2/0NAAAAAElFTkSuQmCC';
      const ab = wx.base64ToArrayBuffer(base64);
      const fs = wx.getFileSystemManager();
      const localPath = `${wx.env.USER_DATA_PATH}/diag_${Date.now()}.png`;
      fs.writeFileSync(localPath, ab, 'binary');
      const fileID = await new Promise((resolve, reject) => {
        wx.cloud.uploadFile({ cloudPath: `goods/diag/diag_${Date.now()}.png`, filePath: localPath, success: r => resolve(r.fileID), fail: reject });
      });
      const r = await globalThis.__cloudCall.call('goods', {
        action: 'publish', title: '诊断测试' + Date.now(), desc: '', images: [fileID],
        price: '1', originalPrice: '', category: 'other', condition: 'normal', pickupPoint: '', type: 'sell'
      });
      if (!r || !r._id) return { ok: false, stage: 'publish-result', r };
      const newId = r._id;
      const del = await globalThis.__cloudCall.call('goods', { action: 'remove', id: newId }).catch(e => ({ _err: e }));
      return { ok: true, fileID, newId, removed: del && !del._err };
    } catch (e) { return { ok: false, thrown: String(e && (e.msg || e.message || e)), stack: e && e.stack }; }
  });
  console.log('C. 真上传+publish+删除 →', JSON.stringify(c, null, 2));
  const cOk = c && c.ok;
  console.log(`   ${cOk ? '✅' : '❌'} publish 链路${cOk ? '真机跑通' : '失败：' + (c.thrown || '')}\n`);

  console.log('='.repeat(46));
  console.log('综合：', aOk && bOk && cOk ? '🎉 全部通过' : '⚠️ 有失败');
  process.exit(aOk && bOk && cOk ? 0 : 1);
})().catch(e => { console.error('❌ 异常', e.message); process.exit(1); });