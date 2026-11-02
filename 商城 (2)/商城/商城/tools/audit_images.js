// tools/audit_images.js —— 全量图片体检：找出所有空值 / 非 http(s) 的图片字段
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
const kind = v => (!v ? 'EMPTY' : (String(v).indexOf('https://') === 0 ? 'https' : (String(v).indexOf('cloud://') === 0 ? 'cloud' : (String(v).indexOf('http://') === 0 ? 'http' : (String(v).indexOf('wxfile://') === 0 ? 'wxfile' : 'OTHER:' + String(v).slice(0, 24))))));

(async () => {
  const out = { problems: [] };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 所有商品（各状态）
    const all = await callCF(mp, 'admin', { action: 'listGoods', status: '', page: 1, pageSize: 100 });
    const gs = (all.data && all.data.list) || [];
    out.goodsCount = gs.length;
    console.log(`[商品] 共 ${gs.length} 条`);
    gs.forEach((g, i) => {
      const kc = kind(g.cover);
      const imgs = Array.isArray(g.images) ? g.images : [];
      const badImgs = imgs.map((f, j) => ({ j, k: kind(f) })).filter(x => x.k !== 'https' && x.k !== 'cloud');
      const bad = kc !== 'https' && kc !== 'cloud';
      console.log(`  #${i} ${String(g._id).slice(-6)} st=${g.status} cover=${kc} imgs=${imgs.length}${badImgs.length ? ' badImgs=' + JSON.stringify(badImgs) : ''} "${String(g.title || '').slice(0, 12)}"`);
      if (bad || badImgs.length) out.problems.push({ where: 'goods', id: String(g._id).slice(-6), status: g.status, title: g.title, cover: kc, badImgs });
    });

    // 2) 所有用户头像
    const us = await callCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 100 });
    const ul = (us.data && us.data.list) || [];
    out.usersCount = ul.length;
    console.log(`[用户] 共 ${ul.length} 条`);
    ul.forEach((u, i) => {
      const ka = kind(u.avatarUrl);
      console.log(`  #${i} ${String(u._openid).slice(-6)} avatar=${ka} "${String(u.nickName || '').slice(0, 10)}"`);
      if (ka !== 'https') out.problems.push({ where: 'user', openid: String(u._openid).slice(-6), nick: u.nickName, avatar: ka });
    });

    // 3) 会话头像（chat.conversations）
    const cv = await callCF(mp, 'chat', { action: 'conversations' });
    const cl = (cv.data && cv.data.list) || [];
    out.convCount = cl.length;
    console.log(`[会话] 共 ${cl.length} 条`);
    cl.forEach((c, i) => {
      const ka = kind(c.peerInfo && c.peerInfo.avatarUrl);
      console.log(`  #${i} peer avatar=${ka}`);
      if (ka !== 'https' && ka !== 'EMPTY') out.problems.push({ where: 'conv', id: String(c._id).slice(-6), avatar: ka });
    });

    // 4) 订单快照
    const od = await callCF(mp, 'order', { action: 'list', role: 'buyer', page: 1, pageSize: 50 });
    const ol = (od.data && od.data.list) || [];
    out.orderCountBuyer = ol.length;
    const od2 = await callCF(mp, 'order', { action: 'list', role: 'seller', page: 1, pageSize: 50 });
    const ol2 = (od2.data && od2.data.list) || [];
    out.orderCountSeller = ol2.length;
    [...ol, ...ol2].forEach((o, i) => {
      const snap = o.goodsSnapshot || {};
      const kc = kind(snap.cover);
      console.log(`  [订单#${i}] cover=${kc}`);
      if (kc !== 'https' && kc !== 'EMPTY') out.problems.push({ where: 'order', id: String(o._id).slice(-6), cover: kc });
    });

    console.log('\n[问题汇总]');
    if (!out.problems.length) console.log('  ✅ 未发现空值 / 非 http 的图片字段');
    else out.problems.forEach(p => console.log('  ❌ ' + JSON.stringify(p)));
    out.problemCount = out.problems.length;
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify({ goodsCount: out.goodsCount, usersCount: out.usersCount, convCount: out.convCount, orderCountBuyer: out.orderCountBuyer, orderCountSeller: out.orderCountSeller, problemCount: out.problemCount, problems: out.problems, fatal: out.fatal }, null, 2));
})();
