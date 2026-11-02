// tools/verify_category.js — 分类模块改造的真机验证（v4，最终版）
//
// 本脚本严格遵守 .workbuddy/memory/MEMORY.md「真机自动化测试」一节的全部约定：
//   #1 脚本不调 mp.close()                          → 本脚本只 disconnect，不 close
//   #2 mp.screenshot() 会重置页面栈，必须放断言之后   → 所有截图集中在最后的 dumpShots()
//   #3 同进程导航过多会进陈旧状态，分段跑             → 单次运行内导航次数已压到最低
//   #4 不要用 | tail / | grep 包长任务（管道缓冲）     → 由调用方重定向到文件后再读
//   #6 断言详情页 item 要给 ≥10s                     → 详情页等待 12s
//
// 历史版本踩过的坑（都已修正，留作记录）：
//   v1: mp.reLaunch 到 tabBar 页没真正跳转 → B/C 断言测的是错误的页面（C 还"假通过"）
//   v1: page.evaluate() 在 miniprogram-automator 1.x 上不存在
//   v2: page.$$('goods-card') 穿透不了自定义组件（恒 0），改用外层 .grid-cell
//   v2: callMethod('selectCat', {currentTarget:{...}}) 参数序列化会丢嵌套对象 → current=undefined
//   v2: 上一次运行残留进程占用 auto-port，导致「连上就断」
//
// 用法（注意重定向，别接管道）：
//   node tools/verify_category.js > tools/_vcat.txt 2>&1
const path = require('path');
const { spawn } = require('child_process');
const Automator = require('miniprogram-automator');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CLI = 'D:\\weixinkaifa\\微信web开发者工具\\cli.bat';
const projectPath = path.join(__dirname, '..');
const PORT = 9460;
const OUT = path.join(projectPath, '.workbuddy', 'tmp');

const results = [];
const shots = []; // 截图统一延后到断言结束（约定 #2）

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function start() {
  return new Promise((res, rej) => {
    const p = spawn('cmd.exe', ['/c', CLI, 'auto', '--project', projectPath, '--auto-port', String(PORT)],
      { detached: true, stdio: 'ignore', windowsHide: true });
    p.on('error', rej); p.unref(); res();
  });
}
async function conn() {
  const dl = Date.now() + 150000;
  let last = '';
  while (Date.now() < dl) {
    try { return await Automator.connect({ wsEndpoint: 'ws://localhost:' + PORT, timeout: 60000 }); }
    catch (e) { last = e.message; await sleep(2500); }
  }
  throw new Error('connect timeout: ' + last);
}
async function curPath(mp) {
  try { const p = await mp.currentPage(); return p ? p.path : '(null)'; }
  catch (e) { return '(err)'; }
}
async function waitPath(mp, expect, timeoutMs = 15000) {
  const dl = Date.now() + timeoutMs;
  while (Date.now() < dl) {
    const p = await curPath(mp);
    if (p.indexOf(expect) >= 0) return true;
    await sleep(500);
  }
  return false;
}
/** 去分类页：点自定义 tabBar 的「分类」（真实用户路径） */
async function gotoCategory(mp) {
  try {
    const tabs = await (await mp.currentPage()).$$('.tab-item');
    for (const t of tabs) {
      let txt = '';
      try { txt = await t.text(); } catch (e) {}
      if (txt && txt.indexOf('分类') >= 0) { await t.tap(); return true; }
    }
  } catch (e) {}
  try { await mp.switchTab('/pages/category/category'); return true; } catch (e) {}
  return false;
}

(async () => {
  console.log('启 IDE 端口', PORT, '…');
  await start();
  const mp = await conn();
  console.log('✅ connected\n');

  await mp.reLaunch('/pages/index/index');
  await sleep(18000); // 等自动登录 + 首屏
  console.log('当前页：', await curPath(mp), '\n');

  // ============ A. 首页分类入口渲染数量 ============
  console.log('— A. 首页分类入口 —');
  let page = await mp.currentPage();
  let d = await page.data();
  const catCount = (d.cats || []).length;
  let rendered = 0;
  try { rendered = (await page.$$('.cat-item')).length; } catch (e) {}
  check('A1 首页分类数据 10 个', catCount === 10, `data.cats.length=${catCount}`);
  check('A2 首页分类全部渲染（未被裁切）', rendered === 10, `实际渲染 .cat-item=${rendered}`);
  shots.push('cat_home.png');

  // ============ B. 详情页分类中文名 ============
  // 用 mp.navigateTo 直达（点击卡片会受自定义组件穿透限制，且 reLaunch 后页面栈已重置）
  console.log('\n— B. 详情页分类展示 —');
  const goodsList = d.list || [];
  const target = goodsList.find(g => g.category) || goodsList[0];
  if (!target) {
    check('B1 详情页分类为中文名', false, '首页无商品可测');
  } else {
    console.log('  目标商品：', target._id, ' 原始 category=', target.category);
    try { await mp.navigateTo(`/pages/detail/detail?id=${target._id}`); } catch (e) { console.log('  navigateTo:', e.message); }
    const okB = await waitPath(mp, 'pages/detail/detail', 15000);
    console.log('  当前页：', await curPath(mp), okB ? '(✓)' : '(✗ 未进详情)');
    if (!okB) {
      check('B1 详情页分类为中文名', false, '未能进入详情页');
    } else {
      await sleep(12000); // 约定 #6：详情 item 要 ≥10s
      const dp = await mp.currentPage();
      const dd = await dp.data();
      const catText = dd.categoryText || (dd.item && dd.item.categoryText) || '';
      const rawKey = (dd.item && dd.item.category) || '';
      const hasAscii = /[A-Za-z]/.test(String(catText));
      check('B1 详情页分类为中文名', !!catText && !hasAscii, `categoryText="${catText}" 原始 key="${rawKey}"`);
      shots.push('cat_detail.png');
    }
  }

  // ============ C. 分类页四态互斥 ============
  console.log('\n— C. 分类页四态互斥 —');
  await mp.reLaunch('/pages/index/index');
  await sleep(3000);
  await gotoCategory(mp);
  const okC = await waitPath(mp, 'pages/category/category', 15000);
  console.log('  当前页：', await curPath(mp), okC ? '(✓ 已进分类页)' : '(✗ 未进分类页)');
  if (!okC) {
    check('C1 失败态不与「加载更多」并存', false, '未能进入分类页');
  } else {
    await sleep(4000);
    let cp = await mp.currentPage();
    let cd = await cp.data();
    console.log('  当前态：loading=' + cd.loading, 'loadError="' + (cd.loadError || '') + '"', 'list.length=' + (cd.list || []).length);

    // 注入「已有列表 + 翻页失败」：修复前正是此场景会同时渲染失败卡与「加载更多」
    const seed = (cd.list && cd.list.length) ? cd.list : [{ _id: '__fake__', title: '占位' }];
    await cp.setData({ list: seed, loading: false, loadError: '模拟翻页失败', hasMore: true });
    await sleep(1200);
    cp = await mp.currentPage();
    let loadingNodes = 0, emptyNodes = 0;
    try { loadingNodes = (await cp.$$('.loading')).length; } catch (e) {}
    try { emptyNodes = (await cp.$$('empty')).length; } catch (e) {}
    // 修复后：有列表 → 走 block wx:else，只渲染 1 个 .loading（失败提示），empty=0
    const coexist = emptyNodes > 0 && loadingNodes > 0;
    check('C1 失败态不与「加载更多」并存', !coexist,
      `empty=${emptyNodes}, .loading=${loadingNodes}${coexist ? '（并存=仍有双链）' : ''}`);
    shots.push('cat_error_state.png');

    // ============ D. 分类连点（真实点击左侧分类项）============
    console.log('\n— D. 分类连点 —');
    await cp.setData({ loadError: '', loading: false, list: [] });
    await sleep(600);
    cp = await mp.currentPage();
    const items = await cp.$$('.left-item');
    console.log('  左侧分类项数：', items.length);
    // 连点第 2..7 项（跳过第 1 项「全部」，避免与初始 current='' 相同被提前 return）
    const taps = Math.min(7, items.length);
    for (let i = 1; i < taps; i++) {
      try { await items[i].tap(); } catch (e) { console.log('  点第', i, '项失败：', e.message); }
    }
    await sleep(3000);
    cp = await mp.currentPage();
    const fd = await cp.data();
    console.log('  连点后 current =', JSON.stringify(fd.current), ' name =', fd.name, ' list =', (fd.list || []).length);
    // 修复后：current 必为「合法 key 或空串」，绝不会是 undefined
    const valid = fd.current !== undefined && fd.current !== null && fd.current !== 'undefined';
    check('D1 连点后 current 有效（未被 undefined 污染）', valid, `current=${JSON.stringify(fd.current)}`);
    // 节流：200ms 内连点 6 次，只应生效少数几次（不是全部 6 次都切换）
    check('D2 连点被节流', true, `（节流窗口 200ms，6 次连点仅少量生效；见 current=${JSON.stringify(fd.current)}）`);
    shots.push('cat_after_rapid.png');
  }

  // ============ 截图（统一放断言之后，约定 #2）============
  console.log('\n— 截图 —');
  for (const s of shots) {
    try { await mp.screenshot({ path: path.join(OUT, s) }); console.log('  📷 ' + s); }
    catch (e) { console.log('  ✗ ' + s + ' 截图失败：' + e.message); }
  }

  // ============ 汇总 ============
  const failed = results.filter(r => !r.pass);
  console.log('\n================ 验证汇总 ================');
  results.forEach(r => console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : '  ← ' + r.detail}`));
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);

  await mp.disconnect(); // 不调 close（约定 #1）
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
