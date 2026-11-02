// tools/live_admin_test.js
// 真机验证：管理后台改造（四个统计卡跳转 + 商品审核流 + 反馈二次处理）
// 用法：先 `cli auto --project "D:\商城" --auto-port 9420` 激活自动化，再 node 本脚本。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');

const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

// 带超时保护的 evaluate：单个调用挂死/被拒也不拖垮整体（务必 .catch，否则底层 reject 变未捕获异常）
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args)
    .then(v => v)
    .catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([
    p,
    new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))
  ]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({
      name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) })
    });
  }), name, data);
}
async function injectErrors(mp) {
  await evalSafe(mp, () => {
    try {
      if (!globalThis.__errs) {
        globalThis.__errs = [];
        const orig = console.error;
        console.error = function () {
          try { globalThis.__errs.push(Array.prototype.map.call(arguments, a => (a && a.stack) || String(a)).join(' ').slice(0, 400)); } catch (e) {}
          return orig.apply(console, arguments);
        };
      }
    } catch (e) {}
    return true;
  });
}
async function getErrors(mp) {
  const r = await evalSafe(mp, () => (globalThis.__errs || []).slice());
  return r && r.__timeout ? [] : r;
}
async function reLaunch(mp, url) {
  return evalSafe(mp, u => new Promise(res => {
    wx.reLaunch({ url: u, success: () => res('ok'), fail: e => res('fail:' + (e && e.errMsg || e)) });
  }), url);
}

(async () => {
  const result = { pages: {}, flows: {}, errors: {} };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    console.log('[connect] ok');
    await wait(3000); // 预热：自动化连接后首个 evaluate 偶发协议超时，先等 IDE 稳定
    const warm = await evalSafe(mp, () => 1 + 1);
    console.log('[warmup]', JSON.stringify(warm));
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e', traceUser: true }); } catch (e) {} return true; });
    await injectErrors(mp);

    // 1) 管理主页
    await reLaunch(mp, '/pages/admin/admin'); await wait(1200);
    result.pages.admin = await getErrors(mp);
    const stats = await callCF(mp, 'admin', { action: 'stats' });
    result.flows.stats = stats && stats.data ? stats.data : stats;
    result.flows.stats_hasPendingGoods = !!(stats && stats.data && ('pendingGoods' in stats.data));

    // 1.5) 发布→待审核（用「求购」商品免图片，验证进入审核流入口）
    const pub = await callCF(mp, 'goods', { action: 'publish', isWant: true, title: '【自动化测试】求购验证发布', desc: '自动化测试', category: 'book', price: 0 });
    await wait(600);
    const newId = pub && pub.data && pub.data._id;
    const pendChk = await callCF(mp, 'admin', { action: 'listGoods', status: 'pending', pageSize: 20 });
    const inPending = pendChk && pendChk.data ? (pendChk.data.list || []).some(g => g._id === newId) : false;
    let onSaleAfterReview = false;
    if (newId) {
      await callCF(mp, 'admin', { action: 'reviewGoods', id: newId, pass: true });
      await wait(400);
      const onSale = await callCF(mp, 'admin', { action: 'listGoods', status: 'onSale', pageSize: 50 });
      onSaleAfterReview = onSale && onSale.data ? (onSale.data.list || []).some(g => g._id === newId) : false;
      await callCF(mp, 'admin', { action: 'adminOff', id: newId, reason: '自动化测试还原' }); // 还原为已下架，避免污染
    }
    result.flows.publishToPending = { publishOk: !!(pub && pub.code === 0), inPending, onSaleAfterReview };

    // 2) 商品管理 - 待审核（仅加载验证，不依赖有待审核数据）
    await reLaunch(mp, '/pages/admin-goods/admin-goods?tab=pending'); await wait(1200);
    result.pages['admin-goods'] = await getErrors(mp);
    const pg = await callCF(mp, 'admin', { action: 'listGoods', status: 'pending', pageSize: 5 });
    result.flows.listGoods_pending = pg && pg.data ? (pg.data.list || []).length : ('ERR:' + JSON.stringify(pg));
    // 用一条「已下架」商品验证 reviewGoods 上架动作（结束再下架还原，不污染数据）
    const offGoods = await callCF(mp, 'admin', { action: 'listGoods', status: 'off', pageSize: 5 });
    const offList = (offGoods && offGoods.data && offGoods.data.list) || [];
    if (offList.length) {
      const gid = offList[0]._id;
      const r1 = await callCF(mp, 'admin', { action: 'reviewGoods', id: gid, pass: true });
      await wait(500);
      const onSale = await callCF(mp, 'admin', { action: 'listGoods', status: 'onSale', pageSize: 50 });
      const inOnSale = onSale && onSale.data ? (onSale.data.list || []).some(g => g._id === gid) : false;
      const r2 = await callCF(mp, 'admin', { action: 'adminOff', id: gid, reason: '自动化测试还原' });
      await wait(500);
      const offAgain = await callCF(mp, 'admin', { action: 'listGoods', status: 'off', pageSize: 50 });
      const restored = offAgain && offAgain.data ? (offAgain.data.list || []).some(g => g._id === gid) : false;
      result.flows.reviewGoods = { approveOk: !!(r1 && r1.code === 0), movedToOnSale: inOnSale, offOk: !!(r2 && r2.code === 0), restoredToOff: restored };
    } else {
      result.flows.reviewGoods = 'skip: 无已下架商品可验证';
    }

    // 3) 用户管理
    await reLaunch(mp, '/pages/admin-users/admin-users'); await wait(1000);
    result.pages['admin-users'] = await getErrors(mp);

    // 4) 审核中心 - 反馈（构造自包含闭环：提交→已处理→二次处理→再处理）
    await reLaunch(mp, '/pages/admin-reviews/admin-reviews?tab=feedback'); await wait(1200);
    result.pages['admin-reviews-feedback'] = await getErrors(mp);
    const sub = await callCF(mp, 'feedback', { action: 'submit', kind: 'other', content: '【自动化测试】反馈二次处理流程验证' });
    await wait(500);
    const pend1 = await callCF(mp, 'feedback', { action: 'list', status: 'pending', pageSize: 20 });
    const fid = (pend1 && pend1.data && pend1.data.list && pend1.data.list.find(f => f.content && f.content.indexOf('自动化测试') !== -1) || {})._id
      || (pend1 && pend1.data && pend1.data.list && pend1.data.list[0] && pend1.data.list[0]._id);
    if (fid) {
      const r1 = await callCF(mp, 'feedback', { action: 'handle', id: fid, status: 'resolved' });
      await wait(500);
      const afterResolve = await callCF(mp, 'feedback', { action: 'list', status: 'pending', pageSize: 20 });
      const stillPending = afterResolve && afterResolve.data ? (afterResolve.data.list || []).some(f => f._id === fid) : true;
      const r2 = await callCF(mp, 'feedback', { action: 'handle', id: fid, status: 'pending' });
      await wait(500);
      const afterReopen = await callCF(mp, 'feedback', { action: 'list', status: 'pending', pageSize: 20 });
      const reopened = afterReopen && afterReopen.data ? (afterReopen.data.list || []).some(f => f._id === fid) : false;
      const r3 = await callCF(mp, 'feedback', { action: 'handle', id: fid, status: 'resolved' });
      result.flows.feedbackRoundTrip = {
        submitOk: !!(sub && sub.code === 0),
        resolveOk: !!(r1 && r1.code === 0),
        removedFromPending: !stillPending,
        reopenOk: !!(r2 && r2.code === 0),
        reopenedToPending: reopened,
        finalResolveOk: !!(r3 && r3.code === 0)
      };
    } else {
      result.flows.feedbackRoundTrip = 'skip: 提交反馈后未取到记录';
    }

    // 5) 审核中心 - 举报 / 认证 tab 加载
    await reLaunch(mp, '/pages/admin-reviews/admin-reviews?tab=report'); await wait(1000);
    result.pages['admin-reviews-report'] = await getErrors(mp);
    await reLaunch(mp, '/pages/admin-reviews/admin-reviews?tab=verify'); await wait(1000);
    result.pages['admin-reviews-verify'] = await getErrors(mp);

    for (const k of Object.keys(result.pages)) result.errors[k] = result.pages[k];
  } catch (e) {
    console.error('[fatal]', e && e.stack || e);
    result.fatal = String(e && e.stack || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(result, null, 2));
})();
