// 自动化验证：标题校验（长度/违禁词）+ order.checkTimeout 云函数
const automator = require('miniprogram-automator');

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  console.log('[1] connected');

  // 进入发布页（tabBar 页用 reLaunch）
  const page = await mp.reLaunch('/pages/publish/publish');
  await page.waitFor(800);
  console.log('[2] on publish page:', page.path);

  // 在 app service 上下文 hook wx.showToast，记录调用
  await mp.evaluate(() => {
    wx.__toastCalls = [];
    if (!wx.__origShowToast) {
      wx.__origShowToast = wx.showToast;
      wx.showToast = function (opts) {
        wx.__toastCalls.push((opts && opts.title) || '');
        return wx.__origShowToast.call(wx, opts);
      };
    }
  });
  console.log('[3] showToast hooked');

  const getToasts = () => mp.evaluate(() => wx.__toastCalls || []);
  const clearToasts = () => mp.evaluate(() => { wx.__toastCalls = []; });

  const input = await page.$('.title-input');
  const submitBtn = await page.$('.btn-primary');
  if (!input || !submitBtn) throw new Error('找不到标题输入框或发布按钮');
  console.log('[4] elements found');

  // 用例 A：标题只有 1 个字
  await clearToasts();
  await input.input('1');
  await submitBtn.tap();
  await page.waitFor(400);
  let toasts = await getToasts();
  console.log('[A] title="1"  →', JSON.stringify(toasts));
  if (!toasts.some(t => t.indexOf('2~30') !== -1)) throw new Error('FAIL A: 未拦截单字标题');

  // 用例 B：违禁词
  await clearToasts();
  await input.input('出售代考答案包过');
  await submitBtn.tap();
  await page.waitFor(400);
  toasts = await getToasts();
  console.log('[B] title=违禁词 →', JSON.stringify(toasts));
  if (!toasts.some(t => t.indexOf('违禁词') !== -1)) throw new Error('FAIL B: 未拦截违禁词');

  // 用例 C：正常标题（应越过标题校验，卡在"请至少上传一张图"）
  await clearToasts();
  await input.input('九成新高等数学教材');
  await submitBtn.tap();
  await page.waitFor(400);
  toasts = await getToasts();
  console.log('[C] 正常标题   →', JSON.stringify(toasts));
  if (!toasts.some(t => t.indexOf('上传') !== -1)) throw new Error('FAIL C: 正常标题未通过标题校验');

  // 用例 D：服务端 order.checkTimeout 直接调用
  const r = await mp.evaluate(() =>
    wx.cloud.callFunction({ name: 'order', data: { action: 'checkTimeout' } })
      .then(res => res.result).catch(e => ({ code: -99, msg: String(e) }))
  );
  console.log('[D] order.checkTimeout →', JSON.stringify(r));
  if (!r || r.code !== 0) throw new Error('FAIL D: checkTimeout 调用失败');

  // 用例 E：服务端 goods.publish 标题校验（绕过前端直接调云函数）
  const r2 = await mp.evaluate(() =>
    wx.cloud.callFunction({ name: 'goods', data: { action: 'publish', title: '1', price: 10, category: 'book', images: ['cloud://fake.123'] } })
      .then(res => res.result).catch(e => ({ code: -99, msg: String(e) }))
  );
  console.log('[E] 服务端 publish title="1" →', JSON.stringify(r2));
  if (!r2 || r2.code === 0 || r2.msg.indexOf('2~30') === -1) throw new Error('FAIL E: 服务端未拦截单字标题');

  await mp.evaluate(() => { if (wx.__origShowToast) wx.showToast = wx.__origShowToast; });
  console.log('\nALL TESTS PASSED');
  await mp.disconnect();
}

main().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
