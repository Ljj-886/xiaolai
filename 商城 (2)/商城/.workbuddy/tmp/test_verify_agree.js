/**
 * 验证 verify 页新增的「明示同意勾选」交互：
 *  1. 初始未勾选
 *  2. toggleAgree 能来回切换
 *  3. 未勾选时 submit 被拦下并提示（不会走到上传/提交）
 *  4. 已勾选且信息齐全时才真正提交，并带上 agreed/agreedAt
 */
const Module = require('module');
const path = require('path');
const orig = Module._load;

const TOASTS = [];
const CALLS = [];

global.wx = {
  showToast(o) { TOASTS.push(o); },
  hideLoading() {}, showLoading() {},
  showModal(o) { if (o && o.success) o.success({ confirm: true }); },
  navigateTo() {}, setClipboardData(o) { if (o && o.success) o.success({}); },
  getStorageSync() { return null; }, setStorageSync() {}, removeStorageSync() {},
  cloud: { uploadFile: async () => ({ fileID: 'cloud://x.png' }) }
};
global.getApp = () => ({ globalData: { openid: 'u1', userInfo: {} } });

let CFG = null;
global.Page = cfg => { CFG = cfg; };

Module._load = function (request) {
  if (request.indexOf('utils/cloud.js') >= 0) {
    return { call: async (name, data) => { CALLS.push({ name, data }); return { submitted: true }; } };
  }
  if (request.indexOf('utils/school.js') >= 0) {
    return { getSchools: async () => [{ name: '惠州经济职业技术学院', level: '专科' }] };
  }
  return orig.apply(this, arguments);
};

let pass = 0, failn = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failn++; console.log('  ✗ ' + n); } };

(async () => {
  require(path.resolve('pages/verify/verify.js'));

  const ctx = {
    data: JSON.parse(JSON.stringify(CFG.data)),
    setData(o) { Object.keys(o).forEach(k => { ctx.data[k] = o[k]; }); },
    fetchMe() {}
  };

  console.log('\n[1] 初始状态');
  check('agreed 默认 false', ctx.data.agreed === false);
  check('toggleAgree 已定义', typeof CFG.toggleAgree === 'function');
  check('goPrivacy 已定义', typeof CFG.goPrivacy === 'function');
  check('goAgreement 已定义', typeof CFG.goAgreement === 'function');

  console.log('\n[2] 勾选切换');
  CFG.toggleAgree.call(ctx);
  check('点击后 agreed = true', ctx.data.agreed === true);
  CFG.toggleAgree.call(ctx);
  check('再点击 agreed = false', ctx.data.agreed === false);

  console.log('\n[3] 未勾选时提交被拦截');
  TOASTS.length = 0; CALLS.length = 0;
  ctx.data.form = { realName: '张三', studentId: '20230101', school: '惠州经济职业技术学院', education: '本科' };
  ctx.data.evidence = ['local.png'];
  await CFG.submit.call(ctx);
  check('提示了需先同意', TOASTS.some(t => /同意/.test(t.title || '')));
  check('未发起云函数调用', CALLS.length === 0);

  console.log('\n[4] 勾选后正常提交并带同意留痕');
  TOASTS.length = 0; CALLS.length = 0;
  ctx.data.agreed = true;
  await CFG.submit.call(ctx);
  check('调用了 user 云函数', CALLS.length === 1 && CALLS[0].name === 'user');
  check('action = applyVerify', CALLS[0] && CALLS[0].data.action === 'applyVerify');
  check('带上 agreed = true', CALLS[0] && CALLS[0].data.agreed === true);
  check('带上 agreedAt', CALLS[0] && typeof CALLS[0].data.agreedAt === 'number');

  console.log('\n[5] 提交成功后表单与勾选都重置');
  check('agreed 重置为 false', ctx.data.agreed === false);
  check('evidence 已清空', Array.isArray(ctx.data.evidence) && ctx.data.evidence.length === 0);
  check('form 已清空', ctx.data.form.realName === '');

  console.log('\n=== 合计: ' + pass + ' 通过 / ' + failn + ' 失败 ===');
  process.exit(failn ? 1 : 0);
})();
