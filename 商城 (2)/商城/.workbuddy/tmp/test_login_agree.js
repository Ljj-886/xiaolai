/**
 * 验证 login 页新增的「协议明示同意」交互：
 *  1. 初始未勾选（本地无记录）
 *  2. toggleAgree 切换并写入本地存储
 *  3. 未勾选时点击「授权并登录」被拦下
 *  4. 勾选后才真正调用 updateProfile
 */
const Module = require('module');
const path = require('path');
const orig = Module._load;

const TOASTS = [];
const CALLS = [];
const STORE = {};

global.wx = {
  showToast(o) { TOASTS.push(o); },
  hideLoading() {}, showLoading() {},
  setStorageSync(k, v) { STORE[k] = v; },
  getStorageSync(k) { return STORE[k] === undefined ? null : STORE[k]; },
  navigateTo() {}, switchTab() {}, navigateBack() {}
};
global.getApp = () => ({ globalData: { openid: 'u1', userInfo: {} } });
global.getCurrentPages = () => [{}, {}];
global.setTimeout = (fn) => { /* 跳过跳转延时，只验证登录主流程 */ };

let CFG = null;
global.Page = cfg => { CFG = cfg; };

Module._load = function (request) {
  if (request.indexOf('utils/cloud.js') >= 0) {
    return { call: async (name, data) => { CALLS.push({ name, data }); return { updated: true }; } };
  }
  return orig.apply(this, arguments);
};

let pass = 0, failn = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failn++; console.log('  ✗ ' + n); } };

(async () => {
  require(path.resolve('pages/login/login.js'));

  const ctx = {
    data: JSON.parse(JSON.stringify(CFG.data)),
    setData(o) { Object.keys(o).forEach(k => { ctx.data[k] = o[k]; }); },
    completeLogin() { ctx._completed = true; }
  };

  console.log('\n[1] 初始状态');
  CFG.onLoad.call(ctx);
  check('agreed 默认 false', ctx.data.agreed === false);
  check('toggleAgree 已定义', typeof CFG.toggleAgree === 'function');
  check('goPrivacy 已定义', typeof CFG.goPrivacy === 'function');

  console.log('\n[2] 勾选切换并落本地存储');
  CFG.toggleAgree.call(ctx);
  check('点击后 agreed = true', ctx.data.agreed === true);
  check('已写入 cm_agreed_v1', STORE['cm_agreed_v1'] === '1');
  CFG.toggleAgree.call(ctx);
  check('再点击回到 false', ctx.data.agreed === false);
  check('存储同步为 0', STORE['cm_agreed_v1'] === '0');

  console.log('\n[3] 未勾选时登录被拦截');
  TOASTS.length = 0; CALLS.length = 0;
  ctx.data.avatarUrl = 'a.png';
  ctx.data.nickName = '小明';
  await CFG.submitLogin.call(ctx);
  check('提示需先同意协议', TOASTS.some(t => /同意/.test(t.title || '')));
  check('未调用云函数', CALLS.length === 0);
  check('未完成登录', !ctx._completed);

  console.log('\n[4] 勾选后正常登录');
  TOASTS.length = 0; CALLS.length = 0;
  CFG.toggleAgree.call(ctx);
  await CFG.submitLogin.call(ctx);
  check('调用了 user 云函数', CALLS.length === 1 && CALLS[0].name === 'user');
  check('action = updateProfile', CALLS[0] && CALLS[0].data.action === 'updateProfile');
  check('完成登录流程', ctx._completed === true);

  console.log('\n=== 合计: ' + pass + ' 通过 / ' + failn + ' 失败 ===');
  process.exit(failn ? 1 : 0);
})();
