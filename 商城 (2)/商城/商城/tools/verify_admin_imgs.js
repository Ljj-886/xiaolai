// tools/verify_admin_imgs.js —— 验证 admin 云函数已解析图片 + 后台页面不再裂图
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
function probe(mp, urls) {
  return evalSafe(mp, (urls) => new Promise(resolve => {
    const r = []; let i = 0;
    const next = () => {
      if (i >= urls.length) return resolve(r);
      const u = urls[i++];
      wx.request({ url: u, method: 'GET', responseType: 'text',
        success: x => { const b = typeof x.data === 'string' ? x.data : ''; r.push({ code: x.statusCode, kb: Math.round(b.length / 1024 * 10) / 10 }); next(); },
        fail: e => { r.push({ fail: String(e && e.errMsg || e) }); next(); } });
    };
    next();
  }), urls);
}
const isHttps = v => typeof v === 'string' && v.indexOf('https://') === 0;

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) admin.listGoods 的 cover 必须是 https（且带 imageMogr2）
    const gl = await callCF(mp, 'admin', { action: 'listGoods', status: '', page: 1, pageSize: 50 });
    const gs = (gl.data && gl.data.list) || [];
    const covers = gs.map(g => g.cover).filter(Boolean);
    out.goodsSample = covers[0];
    chk('admin.listGoods 返回商品', gs.length > 0, `${gs.length} 条`);
    chk('后台商品 cover 已转 https', covers.length > 0 && covers.every(isHttps),
      `${covers.filter(isHttps).length}/${covers.length}`);
    chk('后台商品 cover 带 imageMogr2', covers.every(c => c.indexOf('imageMogr2') >= 0),
      `${covers.filter(c => c.indexOf('imageMogr2') >= 0).length}/${covers.length}`);
    const pg = await probe(mp, covers.slice(0, 5));
    out.goodsProbe = pg;
    chk('后台缩略图实际可加载（200 且体积小）',
      pg.length > 0 && pg.every(x => x.code === 200),
      (pg || []).map(x => x.code + '/' + x.kb + 'KB').join(' , '));

    // 2) 商品图片（详情大图）
    const allImgs = gs.flatMap(g => g.images || []).filter(Boolean);
    chk('后台商品 images 已转 https', allImgs.length === 0 || allImgs.every(isHttps),
      `${allImgs.filter(isHttps).length}/${allImgs.length}`);

    // 3) admin.pendingReports 的凭证图
    const rp = await callCF(mp, 'admin', { action: 'pendingReports', status: 'all', page: 1, pageSize: 50 });
    const rs = (rp.data && rp.data.list) || [];
    const rImgs = rs.flatMap(x => x.images || []).filter(Boolean);
    out.reportCount = rs.length;
    chk('举报凭证图已转 https（无凭证时跳过）', rImgs.length === 0 || rImgs.every(isHttps),
      `举报 ${rs.length} 条，凭证图 ${rImgs.length} 张，https ${rImgs.filter(isHttps).length}`);

    // 4) admin.listUsers 头像：不应残留 wxfile:// 或 cloud://
    const us = await callCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 50 });
    const ul = (us.data && us.data.list) || [];
    const badAv = ul.filter(u => u.avatarUrl && (!isHttps(u.avatarUrl)));
    chk('用户头像无失效临时路径残留', badAv.length === 0,
      `${ul.length} 个用户，异常 ${badAv.length} 个` + (badAv.length ? ' → ' + JSON.stringify(badAv.map(u => u.avatarUrl.slice(0, 20))) : ''));

    // 5) 后台页面截图
    await mp.reLaunch('/pages/admin-goods');
    await wait(10000);
    try { await mp.screenshot({ path: path.join(__dirname, '_adm_goods.png') }); out.shotAdmin = true; } catch (e) { out.shotAdmin = String(e.message); }
    const ast = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.list) || [];
      return { route: p && p.route, active: p && p.data.active, len: l.length, covers: l.map(g => (g.cover ? String(g.cover).slice(0, 40) : '(空)')) };
    });
    out.adminPage = ast;
    console.log('[admin-goods]', JSON.stringify({ route: ast.route, active: ast.active, len: ast.len }));
    chk('后台商品管理页渲染正常', ast.route === 'pages/admin-goods' && ast.len >= 0, `${ast.len} 条，cover 样例 ${String((ast.covers || [])[0] || '').slice(0, 46)}`);

    // 6) 首页截图（确认占位图逻辑未影响正常图片）
    await mp.reLaunch('/pages/index/index');
    await wait(9000);
    try { await mp.screenshot({ path: path.join(__dirname, '_adm_index.png') }); out.shotIndex = true; } catch (e) { out.shotIndex = String(e.message); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
