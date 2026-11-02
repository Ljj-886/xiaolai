/* 通用页面运行时冒烟测试：mock wx/Page/getApp，加载每个页面 .js，
   触发 onLoad/onShow/每个 handler，捕获运行时异常。 */
const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.resolve('pages');

// ---------- 安全代理：让任何云函数返回值都不抛错 ----------
function makeSafeProxy() {
  const arrKeys = new Set(['list','items','goods','orders','messages','convs','records',
    'comments','rows','data','images','pics','tags','categories','schools','pickups',
    'reasons','applyList','verifyList','feedbackList','orderList','chatList','favoriteList',
    'soldList','mineList','searchList','categoryList','reportList','reviewList','creditList',
    'creditLogs','logs','members','users','detail','user','me','info','result','order','goodsInfo']);
  const fnKeys = new Set(['map','forEach','filter','find','some','every','reduce','slice',
    'concat','includes','indexOf','join','sort','push','pop','shift','unshift','splice',
    'findIndex','flat','flatMap','keys','values','entries']);
  const handler = {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'toString') return () => '';
      if (prop === 'valueOf') return () => '';
      if (prop === Symbol.iterator) return [][Symbol.iterator].bind([]);
      if (prop === 'then') return undefined;
      if (typeof prop === 'symbol') return undefined;
      if (fnKeys.has(prop)) return () => [];
      if (arrKeys.has(prop)) return [];
      return makeSafeProxy();
    },
    apply() { return makeSafeProxy(); },
    set() { return true; }
  };
  return new Proxy(function(){}, handler);
}
const safeData = makeSafeProxy();

// ---------- mock wx ----------
const wx = {
  cloud: {
    init() {},
    callFunction() { return Promise.resolve({ result: { code: 0, data: safeData } }); },
    uploadFile(o) { if (o && o.success) o.success({ fileID: 'cloud://x/y' }); return { onProgressUpdate() {} }; },
    downloadFile() { return Promise.resolve({ tempFilePath: 'x' }); }
  },
  showLoading() {}, hideLoading() {}, showToast() {}, hideToast() {},
  showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
  showActionSheet(o) { if (o && o.success) o.success({ tapIndex: 0 }); },
  setNavigationBarTitle() {}, setNavigationBarColor() {},
  authorize(o) { if (o && o.success) o.success({}); },
  getLocation(o) { if (o && o.success) o.success({ latitude: 0, longitude: 0 }); },
  chooseLocation(o) { if (o && o.success) o.success({ name: 'x', address: 'x', latitude: 0, longitude: 0 }); },
  openLocation() {}, getSystemInfo(o) { if (o && o.success) o.success({}); },
  getSystemInfoSync() { return {}; }, openSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  login(o) { if (o && o.success) o.success({ code: 'x' }); }, checkSession(o) { if (o && o.success) o.success({}); },
  requestPayment(o) { if (o && o.success) o.success({}); }, openCard() {},
  getExtConfig(o) { if (o && o.success) o.success({ extConfig: {} }); },
  showShareMenu() {}, updateShareMenu() {}, hideShareMenu() {},
  navigateTo() {}, redirectTo() {}, switchTab() {}, navigateBack() {}, reLaunch() {},
  chooseImage(o) { if (o && o.success) o.success({ tempFilePaths: ['x'] }); },
  chooseMedia(o) { if (o && o.success) o.success({ tempFiles: [{ tempFilePath: 'x', size: 1 }] }); },
  previewImage() {},
  getStorageSync() { return null; }, setStorageSync() {}, removeStorageSync() {},
  requestSubscribeMessage(o) { if (o && o.success) o.success({}); },
  getSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  getUserProfile(o) { if (o && o.success) o.success({ userInfo: { nickName: 'n', avatarUrl: 'a' } }); },
  chooseAddress(o) { if (o && o.success) o.success({}); },
  setClipboardData(o) { if (o && o.complete) o.complete({}); },
  getClipboardData(o) { if (o && o.success) o.success({ data: '' }); },
  createSelectorQuery() {
    const q = { select() { return q; }, selectAll() { return q; }, in() { return q; },
      boundingClientRect() { return q; }, scrollOffset() { return q; },
      exec(cb) { if (cb) cb([]); return q; } };
    return q;
  },
  nextTick(cb) { if (cb) cb(); },
  reportAnalytics() {}, stopPullDownRefresh() {}, startPullDownRefresh() {},
  pageScrollTo() {}, request() { return { on() {}, abort() {} }; }
};
global.wx = wx;

const appStub = {
  globalData: {
    openid: 'openid_test',
    userInfo: { school: '惠州经济职业技术学院', verified: true, nickName: '测试', avatarUrl: 'a', credit: 100 },
    appVersion: '1.0.0'
  },
  initUser() { return Promise.resolve('openid_test'); },
  requireLogin(cb) { if (cb) cb(); },
  isVerified() { return true; },
  _showLoginModal() {}
};
global.getApp = () => appStub;
global.getCurrentPages = () => [{ route: 'pages/index/index' }];

let captured = null;
global.Page = (cfg) => { captured = cfg; };
global.Component = (cfg) => { captured = cfg; };
global.Behavior = (cfg) => cfg;

function setData(inst, patch) {
  if (!patch || typeof patch === 'function') return;
  for (const k of Object.keys(patch)) {
    if (k.indexOf('.') >= 0) {
      const parts = k.split('.');
      let o = inst.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
        o = o[parts[i]];
      }
      o[parts[parts.length - 1]] = patch[k];
    } else {
      inst.data[k] = patch[k];
    }
  }
}

function makeInstance(cfg) {
  const inst = Object.assign({}, cfg);
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
  inst.setData = function (p) { setData(inst, p); };
  inst.selectComponent = () => ({ setData() {}, validate() {}, getData() { return {}; } });
  inst.selectAll = () => [];
  inst.createSelectorQuery = () => wx.createSelectorQuery();
  inst.getTabBar = () => null;
  inst.animate = () => {};
  inst.clearAnimation = () => {};
  inst.getOpenerEventChannel = () => ({ on() {}, emit() {} });
  return inst;
}

function fakeEvent(methodName) {
  const dataset = new Proxy({}, {
    get(t, p) {
      if (p === 'k') return 'smile';
      if (p === 'kind') return 'suggest';
      if (p === 'type') return 'report';
      if (p === 'id') return 'id_test';
      if (p === 'idx' || p === 'index') return 0;
      if (p === 'goodsId') return 'g1';
      if (p === 'orderId') return 'o1';
      if (p === 'openid') return 'u1';
      if (p === 'value') return '';
      return '';
    }
  });
  return {
    currentTarget: { dataset, id: 'id' },
    target: { dataset },
    detail: { value: '', index: 0, tapIndex: 0, user: { nickName: 'n', avatarUrl: 'a' }, encryptedData: '', iv: '' },
    touches: [{}], type: 'tap', timeStamp: 0, mark: {}
  };
}

const LIFECYCLE = new Set(['onLoad','onShow','onReady','onHide','onUnload','onPullDownRefresh',
  'onReachBottom','onShareAppMessage','onShareTimeline','onAddToFavorites','onPageScroll',
  'onTabItemTap','onResize','onSaveExitState','onTitleClick','onOptionMenuClick','onPopMenuClick',
  'onPullIntercept','onBack','onKeyboardHeightChange','data','lifetimes','pageLifetimes','methods',
  'options','behaviors','observers','relations','externalClasses','properties','created','attached','detached']);

function collectHandlers(cfg) {
  const hs = {};
  for (const k of Object.keys(cfg)) {
    if (LIFECYCLE.has(k)) continue;
    if (typeof cfg[k] === 'function') hs[k] = cfg[k];
  }
  if (cfg.methods && typeof cfg.methods === 'object') {
    for (const k of Object.keys(cfg.methods)) {
      if (typeof cfg.methods[k] === 'function') hs[k] = cfg.methods[k];
    }
  }
  return hs;
}

const timeout = (ms) => new Promise((res) => setTimeout(res, ms));
async function settled(p) {
  if (p && typeof p.then === 'function') {
    try { await Promise.race([p, timeout(2500)]); } catch (e) { throw e; }
  }
}

async function runPage(relPath) {
  captured = null;
  const errors = [];
  const abs = path.resolve(relPath);
  try {
    delete require.cache[require.resolve(abs)];
    require(abs);
  } catch (e) {
    return [{ phase: 'require', msg: e.message, stack: e.stack }];
  }
  if (!captured) return [{ phase: 'noConfig', msg: 'Page()/Component() 未被调用' }];
  const cfg = captured;
  const inst = makeInstance(cfg);
  const handlers = collectHandlers(cfg);
  // 生命周期
  for (const ph of ['onLoad', 'onShow', 'onReady', 'onPullDownRefresh', 'onReachBottom', 'onShareAppMessage', 'onPageScroll']) {
    if (typeof cfg[ph] === 'function') {
      try { await settled(cfg[ph].call(inst, ph === 'onLoad' ? { id: 'id_test', orderId: 'o1', goodsId: 'g1', type: 'report', uid: 'u1' } : fakeEvent(ph))); }
      catch (e) { errors.push({ phase: ph, msg: e.message, stack: e.stack }); }
    }
  }
  // 所有业务 handler
  await new Promise(r => setTimeout(r, 120)); // 等待 onLoad/onShow 的异步链完成
  for (const name of Object.keys(handlers)) {
    try { await settled(handlers[name].call(inst, fakeEvent(name))); }
    catch (e) { errors.push({ phase: 'method:' + name, msg: e.message, stack: e.stack }); }
  }
  return errors;
}

(async () => {
  const pages = [];
  for (const d of fs.readdirSync(PAGES_DIR)) {
    const p = path.join(PAGES_DIR, d);
    if (!fs.statSync(p).isDirectory()) continue;
    const js = path.join(p, d + '.js');
    if (fs.existsSync(js)) pages.push(js);
  }
  pages.sort();
  const report = [];
  for (const p of pages) {
    const name = path.basename(path.dirname(p));
    const errs = await runPage(p);
    report.push({ page: name, errors: errs });
  }
  // 输出
  let total = 0;
  const lines = [];
  for (const r of report) {
    if (r.errors.length === 0) {
      lines.push(`✅ ${r.page.padEnd(14)} 无运行时异常`);
    } else {
      total += r.errors.length;
      lines.push(`❌ ${r.page.padEnd(14)} ${r.errors.length} 个异常:`);
      for (const e of r.errors) {
        lines.push(`     [${e.phase}] ${e.msg}`);
      }
    }
  }
  console.log(lines.join('\n'));
  console.log(`\n=== 合计: ${pages.length} 个页面, ${total} 个运行时异常 ===`);
})();
