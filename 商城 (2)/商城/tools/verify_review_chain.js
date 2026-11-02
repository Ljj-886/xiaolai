// tools/verify_review_chain.js —— 端到端验证：发布 → 待审核 → 审核通过 → 上架可见（含重试与彻底清理）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const MARK = '【自动化测试】';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 60000))]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
function callCFRetry(mp, name, data, times = 3) {
  return (async () => {
    for (let i = 0; i < times; i++) {
      const r = await callCF(mp, name, data);
      if (r && r.__fail && String(r.__fail).indexOf('-404006') >= 0) { await wait(1500); continue; }
      if (r && r.__timeout) { await wait(1500); continue; }
      return r;
    }
    return await callCF(mp, name, data);
  })();
}
// 删除所有标题带标记的测试商品（含上一次失败留下的孤儿）
async function cleanup(mp) {
  const all = await callCF(mp, 'admin', { action: 'listGoods', status: '', page: 1, pageSize: 100 });
  const targets = (((all.data && all.data.list) || []).filter(g => String(g.title || '').indexOf(MARK) === 0));
  const removed = [];
  for (const g of targets) {
    const d = await callCF(mp, 'goods', { action: 'remove', id: g._id });
    removed.push({ id: String(g._id).slice(-6), ok: !!(d && d.code === 0) });
  }
  return { found: targets.length, removed };
}

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp, tempId = null;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 先清掉历史孤儿
    out.preClean = await cleanup(mp);
    if (out.preClean.found) console.log('[前置清理] 删除历史测试商品', JSON.stringify(out.preClean));

    const title = MARK + '审核链路 ' + Date.now();
    let pub;
    for (let i = 0; i < 3; i++) {
      pub = await callCFRetry(mp, 'goods', {
        action: 'publish', title, desc: '自动化验证用，稍后自动删除',
        images: [], price: '', category: 'book', condition: 'normal', type: 'want'
      });
      tempId = pub && pub.data && pub.data._id;
      if (tempId) break;
      console.log('[publish 重试]', i, JSON.stringify(pub));
      await wait(2000);
    }
    chk('发布成功并返回 _id', !!tempId, tempId || JSON.stringify(pub));
    if (!tempId) throw new Error('发布失败，无法继续验证链路');

    const d1 = await callCF(mp, 'goods', { action: 'detail', id: tempId });
    chk('新发布商品状态为 pending（待审核）', d1 && d1.data && d1.data.status === 'pending', `status=${d1 && d1.data && d1.data.status}`);

    const mg1 = await callCF(mp, 'user', { action: 'myGoods', status: 'pending', page: 1, pageSize: 50 });
    const inPending = (((mg1.data && mg1.data.list) || []).some(g => g._id === tempId));
    chk('新商品出现在「审核中」列表', inPending, inPending ? '已出现' : '未出现');

    const gl1 = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
    const onHome1 = (((gl1.data && gl1.data.list) || []).some(g => g._id === tempId));
    chk('待审核商品不在首页（符合审核流预期）', !onHome1, onHome1 ? '意外出现在首页' : '未出现在首页');

    const rev = await callCF(mp, 'admin', { action: 'reviewGoods', id: tempId, pass: true });
    chk('管理员「通过上架」调用成功', rev && rev.code === 0, JSON.stringify(rev));

    const d2 = await callCF(mp, 'goods', { action: 'detail', id: tempId });
    chk('审核通过后状态变为 onSale', d2 && d2.data && d2.data.status === 'onSale', `status=${d2 && d2.data && d2.data.status}`);

    const gl2 = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
    const onHome2 = (((gl2.data && gl2.data.list) || []).some(g => g._id === tempId));
    chk('审核通过后出现在首页列表', onHome2, onHome2 ? '已上架可见' : '仍未出现');

    // 再验一次驳回分支
    const pub2 = await callCFRetry(mp, 'goods', {
      action: 'publish', title: MARK + '驳回分支 ' + Date.now(), desc: 'x',
      images: [], price: '', category: 'book', condition: 'normal', type: 'want'
    });
    const id2 = pub2 && pub2.data && pub2.data._id;
    if (id2) {
      const rj = await callCF(mp, 'admin', { action: 'reviewGoods', id: id2, pass: false, reason: '自动化验证' });
      const d3 = await callCF(mp, 'goods', { action: 'detail', id: id2 });
      chk('驳回后状态变为 off 且带驳回原因', rj && rj.code === 0 && d3 && d3.data && d3.data.status === 'off',
        `status=${d3 && d3.data && d3.data.status} reason=${d3 && d3.data && d3.data.offReason}`);
      await callCF(mp, 'goods', { action: 'remove', id: id2 });
    } else {
      chk('驳回分支验证', false, '第二条测试商品发布失败');
    }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp && tempId) { try { await callCF(mp, 'goods', { action: 'remove', id: tempId }); } catch (e) {} }
    if (mp) {
      try {
        out.clean = await cleanup(mp);
        chk('测试数据已彻底清理（无残留）', out.clean.found === 0, `清理后残留 ${out.clean.found} 条`);
      } catch (e) { out.cleanErr = String(e && e.message || e); }
      try { await mp.close(); } catch (e) {}
    }
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
