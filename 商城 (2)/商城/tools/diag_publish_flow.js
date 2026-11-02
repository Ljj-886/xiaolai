// tools/diag_publish_flow.js —— 定位「发布后商品不显示」：查仓库里各状态的商品 + 我的商品 + 学校匹配
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
const t2s = t => (!t ? '-' : new Date(Number(t)).toISOString().replace('T', ' ').slice(5, 19));

(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 0) 我是谁（学校 / 是否管理员）
    const me = await callCF(mp, 'user', { action: 'me' });
    out.me = me && me.data ? { openid: String(me.data._openid).slice(-8), nick: me.data.nickName, school: me.data.school, isAdmin: me.data.isAdmin, verified: me.data.verified, credit: me.data.credit } : me;
    console.log('[me]', JSON.stringify(out.me));

    // 1) 后台统计
    const stats = await callCF(mp, 'admin', { action: 'stats' });
    out.stats = stats && stats.data;
    console.log('[admin.stats]', JSON.stringify(out.stats));

    // 2) 各状态商品（后台视角，含 pending）
    for (const st of ['', 'pending', 'onSale', 'off', 'sold']) {
      const r = await callCF(mp, 'admin', { action: 'listGoods', status: st, page: 1, pageSize: 30 });
      const l = (r.data && r.data.list) || [];
      out['goods_' + (st || 'all')] = {
        total: l.length,
        items: l.map(g => ({ id: String(g._id).slice(-6), title: g.title, status: g.status, campus: g.campus, type: g.type, imgCheck: g.imgCheckStatus, at: t2s(g.createdAt), openid: String(g._openid || '').slice(-8), cover: g.cover ? String(g.cover).slice(0, 30) : '(空)' }))
      };
      console.log(`[listGoods status=${st || 'all'}] ${l.length} 条`);
      out['goods_' + (st || 'all')].items.slice(0, 8).forEach(g => {
        console.log(`   ${g.at} ${g.id} st=${g.status} campus=${g.campus || '(空)'} type=${g.type} img=${g.imgCheck} owner=...${g.openid} "${g.title}"`);
      });
    }

    // 3) 我的商品（不传 status → 返回全部状态）
    const mg = await callCF(mp, 'user', { action: 'myGoods', page: 1, pageSize: 30 });
    const ml = (mg.data && mg.data.list) || [];
    out.myGoodsAll = { total: ml.length, items: ml.map(g => ({ id: String(g._id).slice(-6), title: g.title, status: g.status, campus: g.campus, at: t2s(g.createdAt), cover: g.cover ? String(g.cover).slice(0, 34) : '(空)' })) };
    console.log(`[user.myGoods 不传 status] ${ml.length} 条`);
    out.myGoodsAll.items.slice(0, 10).forEach(g => console.log(`   ${g.at} ${g.id} st=${g.status} campus=${g.campus || '(空)'} "${g.title}" cover=${g.cover}`));

    // 4) 首页视角：goods.list（只返回 onSale + 同校）
    const gl = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 30 });
    const gll = (gl.data && gl.data.list) || [];
    out.homeList = { total: gll.length, school: gl.data && gl.data.school, needSchool: gl.data && gl.data.needSchool, items: gll.map(g => ({ id: String(g._id).slice(-6), title: g.title, status: g.status, campus: g.campus })) };
    console.log(`[goods.list 首页] ${gll.length} 条 school=${out.homeList.school} needSchool=${out.homeList.needSchool}`);

    // 5) 我的商品页实际调用的参数（sold.js 传 status='onSale'）
    const mgOnSale = await callCF(mp, 'user', { action: 'myGoods', status: 'onSale', page: 1, pageSize: 30 });
    out.myGoodsOnSale = { total: ((mgOnSale.data && mgOnSale.data.list) || []).length };
    console.log(`[user.myGoods status=onSale]（我的商品页在售 tab 实际参数） ${out.myGoodsOnSale.total} 条`);
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
