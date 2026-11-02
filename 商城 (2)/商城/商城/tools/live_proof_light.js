// tools/live_proof_light.js
// 决定性验证「列表只解析封面（light 模式）」：
//   临时发布一个多图商品（复用两张已有封面），上架后断言：
//     - cover / images[0] 已被解析为 https
//     - images[1] 仍保持 cloud://（未被解析）→ 证明列表中不再解析全部图片
//   验证后删除临时商品，不留痕。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
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

(async () => {
  const out = {};
  let mp, tmpId;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    console.log('[connect] ok');
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 取两张不同的封面 fileID：
    //    coverA ← 在售商品的封面（会出现在 goods.list(onSale) 中，理应被解析）
    //    coverB ← 已下架商品的封面（不会出现在 onSale 列表中，理应保持 cloud://）
    const onSaleRes = await callCF(mp, 'admin', { action: 'listGoods', status: 'onSale', pageSize: 50 });
    const pick = res => [...new Set(((res.data && res.data.list) || []).map(g => g.cover).filter(c => c && String(c).indexOf('cloud://') === 0))];
    const onSaleCovers = pick(onSaleRes);
    if (!onSaleCovers.length) { out.skip = '在售封面不足，无法构造决定性用例'; return; }
    const coverA = onSaleCovers[0];
    // 第二张图用「用户头像 fileID」：它只走 sellerAvatarUrlMap，永远不会进入列表解析用的 urlMap，
    // 因此若 light 生效，它必须保持 cloud://（不受 _urlCache 影响，结论更干净）。
    const users = await callCF(mp, 'admin', { action: 'listUsers', pageSize: 50 });
    const avatars = [...new Set(((users.data && users.data.list) || []).map(u => u.avatarUrl).filter(a => a && String(a).indexOf('cloud://') === 0))];
    out.availableCovers = { onSale: onSaleCovers.length, avatars: avatars.length };
    if (!avatars.length) { out.skip = '无 cloud:// 头像可用，无法构造用例'; return; }
    const coverB = avatars.find(a => a !== coverA) || avatars[0];
    out.usedCovers = { coverA: coverA.slice(0, 40), coverB: coverB.slice(0, 40), distinct: coverA !== coverB };
    if (coverA === coverB) { out.skip = '两 fileID 相同，无法构造用例'; return; }

    // 2) 发布临时多图商品
    const pub = await callCF(mp, 'goods', {
      action: 'publish', type: 'sell', title: '性能验证临时多图',
      desc: '自动化验证 light 模式，稍后删除', images: [coverA, coverB],
      price: 1, category: 'other', condition: 'normal'
    });
    out.publish = { code: pub && pub.code, msg: pub && pub.msg, id: pub && pub.data && pub.data._id };
    tmpId = pub && pub.data && pub.data._id;
    if (!tmpId) { console.log('[publish failed]', JSON.stringify(out.publish)); return; }
    await wait(500);

    // 3) 审核通过 → onSale（否则 goods.list 默认只返回 onSale）
    const rev = await callCF(mp, 'admin', { action: 'reviewGoods', id: tmpId, pass: true });
    out.review = rev && rev.code;
    await wait(600);

    // 4) 从 goods.list 找它，断言解析行为
    const list = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
    const items = (list.data && list.data.list) || [];
    const g = items.find(x => x._id === tmpId);
    if (!g) { out.assert = 'FAIL: 未在 goods.list 中找到临时商品'; return; }
    out.item = {
      cover: String(g.cover).slice(0, 40),
      coverResolved: String(g.cover).indexOf('https') === 0,
      imagesLen: (g.images || []).length,
      img0Resolved: g.images[0] ? String(g.images[0]).indexOf('https') === 0 : null,
      img1Resolved: g.images[1] ? String(g.images[1]).indexOf('https') === 0 : null,
      img1: g.images[1] ? String(g.images[1]).slice(0, 40) : null
    };
    out.assert = (out.item.coverResolved && out.item.img1Resolved === false)
      ? 'PASS: 封面已解析为 https，非封面图仍为 cloud://（light 生效）'
      : 'FAIL: 解析行为不符合预期';
    console.log('[assert]', out.assert);
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
    console.error('[fatal]', out.fatal);
  } finally {
    // 5) 清理临时商品
    if (mp && tmpId) {
      try {
        const rm = await callCF(mp, 'goods', { action: 'remove', id: tmpId });
        out.cleanup = { code: rm && rm.code, removed: rm && rm.data && rm.data.removed };
      } catch (e) { out.cleanupErr = String(e && e.message || e); }
    }
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
