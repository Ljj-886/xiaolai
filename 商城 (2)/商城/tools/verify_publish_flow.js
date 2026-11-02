// tools/verify_publish_flow.js
// A) 「我的商品 · 审核中」tab 能看到待审核商品
// B) 端到端验证审核链路：发布 → pending（审核中可见）→ 管理员通过 → onSale（首页可见）→ 清理
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
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

    // ================= A) 审核中 tab =================
    await mp.reLaunch('/pages/sold/sold?status=pending');
    await wait(9000);
    const st = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const d = (p && p.data) || {};
      return {
        route: p && p.route, current: d.current,
        tabKeys: (d.tabs || []).map(t => t.key),
        tabLabels: (d.tabs || []).map(t => t.label),
        len: (d.list || []).length,
        statuses: (d.list || []).map(g => g.status),
        covers: (d.list || []).map(g => (g.cover ? String(g.cover).slice(0, 34) : '(空)'))
      };
    });
    out.auditTab = st;
    console.log('[审核中 tab]', JSON.stringify({ route: st.route, current: st.current, tabs: st.tabLabels, len: st.len, statuses: st.statuses }));
    chk('「我的商品」出现了「审核中」tab', (st.tabLabels || []).indexOf('审核中') >= 0, (st.tabLabels || []).join(' / '));
    chk('审核中 tab 能查到待审核商品', st.len > 0 && st.statuses.every(s => s === 'pending'),
      `${st.len} 条，状态 ${[...new Set(st.statuses)].join(',') || '-'}`);
    chk('待审核商品的封面已解析为 https', (st.covers || []).every(c => c.indexOf('https') === 0 || c === '(空)'),
      (st.covers || []).slice(0, 2).join(' , '));
    try { await mp.screenshot({ path: path.join(__dirname, '_pf_pending.png') }); out.shotPending = true; } catch (e) { out.shotPending = String(e.message); }

    // ================= B) 端到端审核链路 =================
    const title = '【自动化测试】审核链路 ' + Date.now();
    const pub = await callCF(mp, 'goods', {
      action: 'publish', title, desc: '自动化验证用，稍后自动删除',
      images: [], price: '', category: 'book', condition: 'normal', type: 'want'
    });
    tempId = pub && pub.data && pub.data._id;
    chk('发布成功并返回 _id', !!tempId, tempId || JSON.stringify(pub));
    if (!tempId) throw new Error('发布失败，后续链路无法验证');

    const d1 = await callCF(mp, 'goods', { action: 'detail', id: tempId });
    chk('新发布的商品状态为 pending（待审核）', d1 && d1.data && d1.data.status === 'pending', `status=${d1 && d1.data && d1.data.status}`);

    const mg1 = await callCF(mp, 'user', { action: 'myGoods', status: 'pending', page: 1, pageSize: 50 });
    const inPending = (((mg1.data && mg1.data.list) || []).some(g => g._id === tempId));
    chk('新商品出现在「审核中」列表里', inPending, inPending ? '已出现' : '未出现');

    const gl1 = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
    const onHome1 = (((gl1.data && gl1.data.list) || []).some(g => g._id === tempId));
    chk('待审核商品不在首页（符合预期）', !onHome1, onHome1 ? '意外出现在首页' : '未出现在首页');

    const rev = await callCF(mp, 'admin', { action: 'reviewGoods', id: tempId, pass: true });
    chk('管理员审核通过调用成功', rev && rev.code === 0, JSON.stringify(rev));

    const d2 = await callCF(mp, 'goods', { action: 'detail', id: tempId });
    chk('审核通过后状态变为 onSale', d2 && d2.data && d2.data.status === 'onSale', `status=${d2 && d2.data && d2.data.status}`);

    const gl2 = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
    const onHome2 = (((gl2.data && gl2.data.list) || []).some(g => g._id === tempId));
    chk('审核通过后出现在首页列表', onHome2, onHome2 ? '已上架可见' : '仍未出现');
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    // 清理临时商品
    if (mp && tempId) {
      try {
        const del = await callCF(mp, 'goods', { action: 'remove', id: tempId });
        out.cleaned = !!(del && del.code === 0);
        const d3 = await callCF(mp, 'goods', { action: 'detail', id: tempId });
        out.removedAfter = !!(d3 && d3.code !== 0);
        out.checks.push({ n: '临时测试商品已清理', p: out.cleaned && out.removedAfter, d: `remove=${out.cleaned} 已不可查=${out.removedAfter}` });
        console.log((out.cleaned && out.removedAfter ? '✅' : '❌') + ' 临时测试商品已清理 — remove=' + out.cleaned + ' 已不可查=' + out.removedAfter);
      } catch (e) { out.cleanErr = String(e && e.message || e); }
    }
    if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
