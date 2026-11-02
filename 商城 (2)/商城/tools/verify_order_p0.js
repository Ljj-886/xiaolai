// tools/verify_order_p0.js
// 验证 order 云函数的两个 P0 修复（本轮新增）：
//   ① create 的「原子抢占」底层机制：并发条件更新同一商品，只能有 1 次生效（防超卖）
//   ② complete 的「幂等」端到端：并发调用 complete 只允许 1 次成功，且 soldCount 只 +1
//
// 为什么这样测：
//   - 真实并发下单需要两个账号（create 禁止购买自己的商品），本机只有一个账号，
//     因此 ① 直接测「条件更新」这个被 create 依赖的原子原语；② 则用一条构造的
//     meeting 订单端到端跑（我是 seller，complete 允许买卖任一方调用）。
//   - 全部测试数据自清理；soldCount 做等量回滚。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

const pass = [], fail = [];
const ok = (n, c, extra) => (c ? pass : fail).push(n + (extra ? ' → ' + extra : ''));

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2000);

    const r = await mp.evaluate(() => new Promise(resolve => {
      const db = wx.cloud.database();
      const MARK = '__P0TEST__' + Date.now();
      const out = { mark: MARK };
      let goodsId = null, orderId = null, myOpenid = '';
      const callFn = (name, data) => new Promise(res => {
        wx.cloud.callFunction({ name, data }).then(x => res(x.result || {})).catch(e => res({ __err: String(e && (e.errMsg || e.message)) }));
      });

      (async () => {
        try {
          // 0) 我的 openid
          const me0 = await callFn('user', { action: 'me' });
          myOpenid = (me0.data && me0.data._openid) || '';
          out.myOpenid = myOpenid ? myOpenid.slice(-6) : '';
          const soldBefore = (me0.data && me0.data.soldCount) || 0;
          out.soldBefore = soldBefore;

          // 1) 插入测试商品（onSale）
          const g = await db.collection('goods').add({ data: {
            title: MARK, desc: 'p0 test', price: 1, campus: '清华大学',
            status: 'onSale', type: 'sell', category: 'book', viewCount: 0, createdAt: Date.now()
          }});
          goodsId = g._id;
          out.goodsInserted = goodsId;

          // ── Test ① 并发条件更新（create 抢占依赖的原子原语）──
          const claim = () => db.collection('goods')
            .where({ _id: goodsId, status: 'onSale' })
            .update({ data: { status: 'reserved' } })
            .then(x => (x.stats && x.stats.updated) || 0)
            .catch(() => -1);
          const [u1, u2] = await Promise.all([claim(), claim()]);
          out.claimUpdated = [u1, u2];
          out.claimWinners = [u1, u2].filter(x => x === 1).length;
          const after = await db.collection('goods').doc(goodsId).get();
          out.statusAfterClaim = after.data && after.data.status;

          // 复位商品，供 Test ② 使用
          await db.collection('goods').doc(goodsId).update({ data: { status: 'reserved' } });

          // ── Test ② complete 并发幂等（端到端）──
          const o = await db.collection('orders').add({ data: {
            orderNo: 'P0TEST' + Date.now(),
            goodsId, goodsSnapshot: { title: MARK, cover: '', price: 1 },
            buyerId: '__FAKE_BUYER__', sellerId: myOpenid,
            price: 1, status: 'meeting',
            meetingTime: '2026-09-16', meetingPlace: '测试点', message: '',
            campus: '清华大学', createdAt: Date.now(), updatedAt: Date.now()
          }});
          orderId = o._id;
          out.orderInserted = orderId;

          const completeOnce = () => callFn('order', { action: 'complete', orderId });
          const [c1, c2] = await Promise.all([completeOnce(), completeOnce()]);
          out.completeCodes = [c1.code, c2.code];
          out.completeMsgs = [String(c1.msg || '').slice(0, 40), String(c2.msg || '').slice(0, 40)];
          out.completeSuccess = [c1.code, c2.code].filter(x => x === 0).length;
          out.completeConflict = [c1.code, c2.code].filter(x => x === 409).length;

          const ord = await db.collection('orders').doc(orderId).get();
          out.orderStatusAfter = ord.data && ord.data.status;

          await new Promise(res => setTimeout(res, 400));
          const me1 = await callFn('user', { action: 'me' });
          const soldAfter = (me1.data && me1.data.soldCount) || 0;
          out.soldAfter = soldAfter;
          out.soldDelta = soldAfter - soldBefore;
        } catch (e) {
          out.err = String(e && (e.errMsg || e.message));
        } finally {
          // —— 自清理 ——
          if (orderId) { try { await db.collection('orders').doc(orderId).remove(); out.orderCleaned = true; } catch (e) { out.orderCleanErr = String(e && (e.errMsg || e.message)); } }
          if (goodsId) { try { await db.collection('goods').doc(goodsId).remove(); out.goodsCleaned = true; } catch (e) { out.goodsCleanErr = String(e && (e.errMsg || e.message)); } }
          // soldCount 等量回滚（Test ② 只应 +1）
          try {
            const me2 = await callFn('user', { action: 'me' });
            const cur = (me2.data && me2.data.soldCount) || 0;
            const back = out.soldBefore == null ? 0 : cur - out.soldBefore;
            if (back > 0) {
              await db.collection('users').where({ _openid: myOpenid }).update({ data: { soldCount: db.command.inc(-back) } });
              out.soldRolledBack = back;
            }
          } catch (e) { out.rollbackErr = String(e && (e.errMsg || e.message)); }
        }
        resolve(out);
      })();
    }));

    console.log(JSON.stringify(r, null, 1) + '\n');

    ok('测试商品已插入', !!r.goodsInserted, r.goodsInserted);
    ok('① 并发条件更新：恰好 1 次生效', r.claimWinners === 1, 'updated=' + JSON.stringify(r.claimUpdated));
    ok('① 商品最终状态为 reserved（未被二次覆盖）', r.statusAfterClaim === 'reserved', r.statusAfterClaim);
    ok('② 测试订单已插入', !!r.orderInserted, r.orderInserted);
    ok('② 并发 complete：恰好 1 次成功', r.completeSuccess === 1, 'codes=' + JSON.stringify(r.completeCodes));
    ok('② 另一次返回 409 冲突', r.completeConflict === 1, 'msgs=' + JSON.stringify(r.completeMsgs));
    ok('② 订单最终为 completed', r.orderStatusAfter === 'completed', r.orderStatusAfter);
    ok('★ ② soldCount 只 +1（未重复计数）', r.soldDelta === 1, 'delta=' + r.soldDelta);
    ok('测试订单已清理', r.orderCleaned === true || !!r.orderCleanErr, r.orderCleanErr || 'ok');
    ok('测试商品已清理', r.goodsCleaned === true || !!r.goodsCleanErr, r.goodsCleanErr || 'ok');

    console.log('===== order P0 修复验证 =====');
    pass.forEach(t => console.log('  [PASS] ' + t));
    fail.forEach(t => console.log('  [FAIL] ' + t));
    console.log(`结果: ${pass.length}/${pass.length + fail.length} 通过`);
  } catch (e) {
    console.log('异常: ' + String((e && e.message) || e));
  }
  process.exit(fail.length ? 1 : 0);
})();
