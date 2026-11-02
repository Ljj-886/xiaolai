// tools/verify_want_fix.js —— 求购模块修复后回归验证
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function assert(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra === undefined ? '' : String(extra).slice(0, 220) });
}
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    const callFn = async (name, data) => evalSafe(mp, (n, d) => wx.cloud.callFunction({ name: n, data: d })
      .then(r => r.result).catch(e => ({ __callErr: String((e && (e.errMsg || e.message)) || e) })), name, data);

    // ---- 修复1：sell 过滤不再混入 want ----
    const ls = await callFn('goods', { action: 'list', type: 'sell', status: 'onSale', pageSize: 20 });
    const lsl = (ls && ls.data && ls.data.list) || [];
    const badSell = lsl.filter(x => x.type === 'want');
    assert('【修复1】goods.list sell 不含 want', badSell.length === 0,
      'n=' + lsl.length + ' 异常=' + badSell.length + (badSell.length ? ' → ' + badSell.map(x => x.title).join('/') : ''));
    const hasUndef = lsl.some(x => x.type === undefined);
    assert('【修复1】历史无 type 商品仍保留（未被漏掉）', hasUndef, '含无type商品=' + hasUndef);

    const lw = await callFn('goods', { action: 'list', type: 'want', status: 'onSale', pageSize: 20 });
    const lwl = (lw && lw.data && lw.data.list) || [];
    assert('【修复1】goods.list want 全为 want', lwl.every(x => x.type === 'want'),
      'n=' + lwl.length + ' types=' + JSON.stringify([...new Set(lwl.map(x => x.type === undefined ? 'UNDEF' : x.type))]));

    const mg = await callFn('user', { action: 'myGoods', type: 'sell', pageSize: 20 });
    const mgl = (mg && mg.data && mg.data.list) || [];
    assert('【修复1】myGoods sell 不含 want', mgl.filter(x => x.type === 'want').length === 0, 'n=' + mgl.length);

    // ---- 修复2：无图求购详情页不再 1/0 ----
    const pub = await callFn('goods', {
      action: 'publish', title: '求购验证2-台灯', desc: '求购一个护眼台灯，预算 80',
      images: [], price: '80', category: 'daily', type: 'want'
    });
    const wid = pub && pub.data && pub.data._id;
    assert('测试求购发布成功', !!wid, JSON.stringify(pub).slice(0, 160));

    if (wid) {
      await callFn('admin', { action: 'reviewGoods', id: wid, pass: true });
      await mp.reLaunch('/pages/detail/detail?id=' + wid);
      await wait(3200);
      const info = await evalSafe(mp, () => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        const d = (p && p.data) || {};
        return { route: p && p.route, hasItem: !!d.item, type: d.item && d.item.type, condText: d.condText,
                 imagesLen: d.item && d.item.images ? d.item.images.length : -1 };
      });
      console.log('  detail:', JSON.stringify(info));
      assert('【修复3】求购详情 condText 为空（不再「正常使用」）', info && info.condText === '',
        'condText=' + JSON.stringify(info && info.condText));

      // 页面元素层面确认没有 hero-indicator（无图不渲染 swiper）
      const hasIndicator = await mp.evaluate(() => {
        return new Promise(res => {
          const q = wx.createSelectorQuery();
          q.select('.hero-indicator').boundingClientRect(r => res(!!r)).exec();
          setTimeout(() => res(null), 1500);
        });
      }).catch(() => null);
      assert('【修复2】无图求购不渲染 1/N 计数器', hasIndicator === false, 'hero-indicator 存在=' + hasIndicator);
      const hasWantHero = await mp.evaluate(() => {
        return new Promise(res => {
          const q = wx.createSelectorQuery();
          q.select('.hero-want').boundingClientRect(r => res(!!r)).exec();
          setTimeout(() => res(null), 1500);
        });
      }).catch(() => null);
      assert('【修复2】无图求购显示专用占位区', hasWantHero === true, 'hero-want 存在=' + hasWantHero);

      await wait(600);
      try { await mp.screenshot({ path: path.join(__dirname, '_want_detail_fixed.png') }); } catch (e) {}

      // ---- 卡片：求购不显示成色 ----
      await mp.reLaunch('/pages/index/index');
      await wait(3500);
      const cardInfo = await evalSafe(mp, () => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        const d = (p && p.data) || {};
        const list = d.list || [];
        const wants = list.filter(x => x.type === 'want');
        return { total: list.length, wantCount: wants.length, titles: wants.map(x => x.title).slice(0, 5) };
      });
      console.log('  index page:', JSON.stringify(cardInfo));
      assert('首页 sell 视图不含求购商品', cardInfo && cardInfo.wantCount === 0,
        'want 数=' + (cardInfo && cardInfo.wantCount) + (cardInfo && cardInfo.wantCount ? ' → ' + cardInfo.titles.join('/') : ''));

      // 切到求购视图
      await mp.evaluate(() => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        if (p && p.setListType) p.setListType({ currentTarget: { dataset: { type: 'want' } } });
      }).catch(() => {});
      await wait(3000);
      const wantView = await evalSafe(mp, () => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        const d = (p && p.data) || {};
        const list = d.list || [];
        return { type: d.type, total: list.length, allWant: list.every(x => x.type === 'want'), titles: list.map(x => x.title).slice(0, 5) };
      });
      console.log('  index want view:', JSON.stringify(wantView));
      assert('首页求购视图全为求购', wantView && wantView.allWant === true, JSON.stringify(wantView).slice(0, 180));
      try { await mp.screenshot({ path: path.join(__dirname, '_want_index_fixed.png') }); } catch (e) {}

      // ---- 清理 ----
      const del = await callFn('goods', { action: 'remove', id: wid });
      assert('（清理）测试求购已删除', del && del.code === 0, JSON.stringify(del).slice(0, 120));
    }
  } catch (e) {
    assert('脚本整体执行', false, String((e && e.message) || e));
  }

  console.log('\n======== 求购修复回归结果 ========');
  let pass = 0;
  results.forEach(r => {
    console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
    if (r.ok) pass++;
  });
  console.log('--------------------------------');
  console.log(`  通过 ${pass}/${results.length}`);
  process.exit(0);
})();
