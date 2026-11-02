// tools/test_avatar_pipeline.js
// 实跑验证"头像上传→持久化→显示"全链路是否真的打通。
// 用小程序自带资源 /images/avatar-default.png 当测试图（它在小程序文件系统里，uploadFile 能访问），
// 跑完即还原（updateProfile 设回空），不污染用户真实数据。
const automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const errors = [];
  mp.on('console', m => { if (m.type === 'error') errors.push(m.args.join(' ')); });
  mp.on('exception', e => errors.push(e.message || JSON.stringify(e)));

  let out = { steps: [] };
  try {
    // 1. 上传测试图到云存储
    const up = await mp.evaluate(async () => {
      const r = await wx.cloud.uploadFile({
        cloudPath: 'avatar/_pipe_test_' + Date.now() + '.png',
        filePath: '/images/avatar-default.png'
      });
      return { fileID: r.fileID, statusCode: r.statusCode };
    });
    out.steps.push({ step: 'upload', ok: !!up.fileID, fileID: up.fileID });
    if (!up.fileID) throw new Error('uploadFile 没返回 fileID');

    // 2. 设为头像
    await mp.evaluate(async (fileID) => {
      const r = await wx.cloud.callFunction({ name: 'user', data: { action: 'updateProfile', avatarUrl: fileID } });
      return r;
    }, up.fileID);

    // 3. 回读 me()，看 cloud:// 是否被云函数转成 https（说明显示链路通）
    const me = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({ name: 'user', data: { action: 'me' } });
      return r && r.result && r.result.data;
    });
    const av = (me && me.avatarUrl) || '';
    out.steps.push({ step: 'read-back', avatarUrl: av, isHttps: av.startsWith('https'), isCloud: av.startsWith('cloud') });

    // 4. 还原（设回空，保持用户真实数据不动）
    await mp.evaluate(async () => {
      await wx.cloud.callFunction({ name: 'user', data: { action: 'updateProfile', avatarUrl: '' } });
    });
    const me2 = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({ name: 'user', data: { action: 'me' } });
      return r && r.result && r.result.data;
    });
    out.steps.push({ step: 'revert', avatarUrl: (me2 && me2.avatarUrl) || '' });
  } catch (e) {
    out.error = e.message || String(e);
  }
  out.consoleErrors = errors;
  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
