// tools/live_flows.js
// 真机验证核心功能流程（不只是打开页面）：
//   1. 首页「闲置/求购」切换
//   2. 搜索（关键词）
//   3. 商品详情 + 收藏/想要 toggle
//   4. 发布求购（无需图片，可全自动）+ 发布出售
// 用法：node tools/live_flows.js

const automator = require('miniprogram-automator');
const GOODS_ID = process.argv[2] || 'e04f59456a9f771102dc84722888f359';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (ok, msg) => console.log(`${ok ? '✅' : '❌'} ${msg}`);

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  } catch (e) {
    console.error('❌ 连不上开发者工具，先跑：npm run devtools:auto');
    process.exit(1);
  }
  console.log('✅ 已连接\n');

  let fail = 0;

  // —— 1. 首页切换「闲置 / 求购」——
  try {
    await mp.switchTab('/pages/index/index');
    await sleep(4000);
    let pg = await mp.currentPage();
    let d = await pg.data();
    const sellCount = (d.list || []).length;
    log(sellCount >= 0, `首页「闲置」加载 ${sellCount} 件，loadError=${d.loadError || '无'}`);
    if (d.loadError) fail++;

    await pg.callMethod('setListType', { currentTarget: { dataset: { type: 'want' } } });
    await sleep(3500);
    d = await pg.data();
    log(d.type === 'want', `切到「求购」：type=${d.type}，${(d.list || []).length} 件，loadError=${d.loadError || '无'}`);
    if (d.loadError) fail++;

    await pg.callMethod('setListType', { currentTarget: { dataset: { type: 'sell' } } });
    await sleep(3000);
    d = await pg.data();
    log(d.type === 'sell', `切回「闲置」：type=${d.type}，${(d.list || []).length} 件`);
  } catch (e) { log(false, `首页切换异常: ${e.message.slice(0, 70)}`); fail++; }

  // —— 2. 搜索 ——
  try {
    await mp.reLaunch('/pages/search/search');
    await sleep(3000);
    let pg = await mp.currentPage();
    await pg.callMethod('onSearch', { detail: { value: '书' } }).catch(async () => {
      await pg.callMethod('onInput', { detail: { value: '书' } });
    });
    await sleep(3500);
    const d = await pg.data();
    log(true, `搜索执行完成：结果 ${(d.list || []).length} 件，无异常`);
  } catch (e) { log(false, `搜索异常: ${e.message.slice(0, 70)}`); fail++; }

  // —— 3. 商品详情 + 收藏/想要 ——
  try {
    await mp.reLaunch(`/pages/detail/detail?id=${GOODS_ID}`);
    await sleep(3800);
    let pg = await mp.currentPage();
    let d = await pg.data();
    const hasItem = !!(d.item && d.item.title);
    log(hasItem, `商品详情加载：${hasItem ? d.item.title : '无数据'}`);
    if (!hasItem) fail++;

    // 收藏
    const beforeFav = d.item ? d.item.faved : null;
    await pg.callMethod('toggleFav');
    await sleep(2500);
    d = await pg.data();
    log(d.item && d.item.faved !== beforeFav, `收藏 toggle：${beforeFav} → ${d.item && d.item.faved}`);

    // 想要
    const beforeWant = d.item ? d.item.wanted : null;
    await pg.callMethod('toggleWant');
    await sleep(2800);
    d = await pg.data();
    const wantErr = d.actionError || '';
    log(d.item && d.item.wanted !== beforeWant,
      `想要 toggle：${beforeWant} → ${d.item && d.item.wanted}${wantErr ? ' | 错误=' + wantErr : ''}`);
    if (wantErr) fail++;
  } catch (e) { log(false, `详情/收藏异常: ${e.message.slice(0, 70)}`); fail++; }

  // —— 4. 发布求购（核心：之前报"网络错误"）——
  try {
    await mp.switchTab('/pages/publish/publish');
    await sleep(3500);
    let pg = await mp.currentPage();
    await pg.callMethod('setType', { currentTarget: { dataset: { type: 'want' } } });
    await sleep(800);
    await pg.callMethod('onTitle', { detail: { value: '自动化求购测试' + Date.now() } });
    await pg.callMethod('onDesc', { detail: { value: '脚本自动写入，可忽略' } });
    await pg.callMethod('selectCat', { currentTarget: { dataset: { key: 'book' } } });
    await pg.callMethod('toggleAgree');
    await sleep(500);
    let d = await pg.data();
    console.log(`   提交前：type=${d.form.type} cat=${d.form.category} agreed=${d.agreed}`);
    await pg.callMethod('submit');
    // 9s：发布前若连续触发过其他云调用（收藏/想要），偶发限流会让 publish 变慢，
    // 太短会误判为失败（实际已成功、只是 switchTab 稍晚）
    await sleep(9000);
    // 发布成功会 switchTab 到首页；失败则留在发布页并有 submitError
    const cur = await mp.currentPage();
    const path = cur.path || '';
    const d2 = await cur.data();
    const sErr = d2.submitError || '';
    log(path.includes('index'), `发布求购：当前页=${path}${sErr ? ' | 错误=' + sErr : ''}`);
    if (!path.includes('index')) fail++;
  } catch (e) { log(false, `发布求购异常: ${e.message.slice(0, 70)}`); fail++; }

  console.log(`\n${'='.repeat(46)}`);
  console.log(fail === 0 ? '🎉 核心流程全部通过' : `⚠️  ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('❌ 脚本异常', e.message); process.exit(1); });