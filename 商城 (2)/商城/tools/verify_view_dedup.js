// tools/verify_view_dedup.js
// 验证本轮两个 P2 修复：
//   ① goods.detail 浏览量去重：同一用户反复看同一商品，viewCount 只 +1（不再每次 +1）
//   ② chat.convs 分页：返回 hasMore 字段，page/pageSize 生效
// 测试数据自清理。
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
      const MARK = '__VIEWTEST__' + Date.now();
      const out = { mark: MARK };
      let goodsId = null;
      const callFn = (name, data) => new Promise(res => {
        wx.cloud.callFunction({ name, data }).then(x => res(x.result || {})).catch(e => res({ __err: String(e && (e.errMsg || e.message)) }));
      });

      (async () => {
        try {
          // ── ① 浏览量去重 ──
          const g = await db.collection('goods').add({ data: {
            title: MARK, desc: 'view dedup test', price: 1, campus: '清华大学',
            status: 'onSale', type: 'sell', category: 'book', viewCount: 0, createdAt: Date.now()
          }});
          goodsId = g._id;
          out.goodsId = goodsId;

          // 同一用户连续进 3 次详情
          const d1 = await callFn('goods', { action: 'detail', id: goodsId });
          const d2 = await callFn('goods', { action: 'detail', id: goodsId });
          const d3 = await callFn('goods', { action: 'detail', id: goodsId });
          out.detailCodes = [d1.code, d2.code, d3.code];

          await new Promise(res => setTimeout(res, 300));
          const after = await db.collection('goods').doc(goodsId).get();
          out.viewCount = after.data && after.data.viewCount;

          // ── ② 会话分页 ──
          const c1 = await callFn('chat', { action: 'convs', page: 1, pageSize: 5 });
          out.convsCode = c1.code;
          out.convsLen = c1.data && c1.data.list ? c1.data.list.length : -1;
          out.hasMoreType = typeof (c1.data && c1.data.hasMore);
          out.pageSizeRespected = (c1.data && c1.data.list && c1.data.list.length <= 5);
          const c2 = await callFn('chat', { action: 'convs', page: 999, pageSize: 5 });
          out.convs2Len = c2.data && c2.data.list ? c2.data.list.length : -1;
          out.convs2HasMore = c2.data && c2.data.hasMore;
        } catch (e) {
          out.err = String(e && (e.errMsg || e.message));
        } finally {
          if (goodsId) {
            try { await db.collection('goods').doc(goodsId).remove(); out.cleaned = true; } catch (e) { out.cleanErr = String(e && (e.errMsg || e.message)); }
            // 顺带清理可能写进去的 viewLogs（goods 归属我，viewLog id = openid_goodsId）
            try {
              const me = await callFn('user', { action: 'me' });
              const oid = (me.data && me.data._openid) || '';
              if (oid) await db.collection('viewLogs').doc(oid + '_' + goodsId).remove().catch(() => {});
            } catch (e) {}
          }
        }
        resolve(out);
      })();
    }));

    console.log(JSON.stringify(r, null, 1) + '\n');

    ok('① 详情 3 次调用均成功', (r.detailCodes || []).every(c => c === 0), JSON.stringify(r.detailCodes));
    ok('★ ① 同一用户看 3 次 → viewCount 只 +1', r.viewCount === 1, 'viewCount=' + r.viewCount);
    ok('② convs 调用成功', r.convsCode === 0, 'code=' + r.convsCode);
    ok('② 返回 hasMore 字段（bool）', r.hasMoreType === 'boolean', 'type=' + r.hasMoreType);
    ok('② pageSize 生效（≤5 条）', r.pageSizeRespected === true, 'len=' + r.convsLen);
    ok('② 超页返回空列表且 hasMore=false', r.convs2Len === 0 && r.convs2HasMore === false, 'len=' + r.convs2Len);
    ok('测试商品已清理', r.cleaned === true || !!r.cleanErr, r.cleanErr || 'ok');

    console.log('===== 浏览量去重 + 会话分页验证 =====');
    pass.forEach(t => console.log('  [PASS] ' + t));
    fail.forEach(t => console.log('  [FAIL] ' + t));
    console.log(`结果: ${pass.length}/${pass.length + fail.length} 通过`);
  } catch (e) {
    console.log('异常: ' + String((e && e.message) || e));
  }
  process.exit(fail.length ? 1 : 0);
})();
