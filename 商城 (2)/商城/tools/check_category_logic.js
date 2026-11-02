// tools/check_category_logic.js — 分类模块的静态/逻辑级校验（不依赖真机）
//
// 为什么需要：真机（miniprogram-automator）受 IDE 稳定性影响（进程反复重生、
// auto-port 被孤儿端口占用），不适合作为每次改动的快速回归手段。
// 本脚本用纯 Node 复刻关键逻辑，覆盖「能用代码判定」的断言，秒级出结果。
// 涉及视觉渲染的（截图）仍由 tools/verify_category.js 在真机上做。
//
// 用法：node tools/check_category_logic.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// ============ 1. 分类映射函数行为 ============
console.log('— 1. catName / catIcon 行为 —');
const { catName, catIcon, catOf, isCatKey, CATEGORIES, ICON_FILE } = require(path.join(root, 'utils', 'categories.js'));

check('catName(book) = 教材书籍', catName('book') === '教材书籍', catName('book'));
check('catName(digital) = 数码电子', catName('digital') === '数码电子', catName('digital'));
check('catName(\'\') = \'\'（全部分类不报错）', catName('') === '', `"${catName('')}"`);
check('catName(null) = \'\'（不抛异常）', catName(null) === '', `"${catName(null)}"`);
check('catName(中文名) 原样返回（兼容脏数据）', catName('数码电子') === '数码电子', catName('数码电子'));
check('catName(未知key) 原样返回（便于排查）', catName('zzz') === 'zzz', catName('zzz'));
check('catIcon 全部指向 /images/cat_*.png', CATEGORIES.every(c => /^\/images\/cat_[a-z]+\.png$/.test(catIcon(c.key))));
check('catOf(非法key) 兜底到「其他闲置」', catOf('zzz').key === 'other', catOf('zzz').name);
check('isCatKey(\'\') = false（空串不是合法分类）', isCatKey('') === false);
check('isCatKey(book) = true', isCatKey('book') === true);
check('10 个分类的 catName 全部非空且不含 ASCII', CATEGORIES.every(c => {
  const n = catName(c.key);
  return n && !/[A-Za-z]/.test(n);
}));

// ============ 2. 三方映射一致性 ============
console.log('\n— 2. key / 图标 / 素材 三方一致 —');
const wxs = read('utils/icon.wxs');
const body = (wxs.match(/var CAT = \{([\s\S]*?)\};/) || [, ''])[1];
const wxsMap = {};
const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']+)'/g;
let m;
while ((m = re.exec(body)) !== null) wxsMap[m[1]] = m[2];
check('icon.wxs 与 ICON_FILE 完全一致',
  JSON.stringify(wxsMap) === JSON.stringify(ICON_FILE),
  `wxs=${Object.keys(wxsMap).length}项 / js=${Object.keys(ICON_FILE).length}项`);
check('所有图标素材文件存在',
  Object.values(ICON_FILE).every(f => fs.existsSync(path.join(root, 'images', f + '.png'))));

// ============ 3. 前端不再有重复映射 / 英文 key 直渲 ============
console.log('\n— 3. 前端收口检查 —');
const pagesJs = [];
(function walk(dir) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const p = dir + '/' + f;
    const st = fs.statSync(path.join(root, p));
    if (st.isDirectory()) walk(p);
    else if (f.endsWith('.js')) pagesJs.push(p);
  }
})('pages');

const dupFind = pagesJs.filter(p => /CATEGORIES\.find/.test(read(p)));
check('无页面再自写 CATEGORIES.find', dupFind.length === 0, dupFind.join(', ') || '干净');

// 精确判断：该文件是否**从 constants.js 解构出 CATEGORIES**。
// 不能用「文件里同时出现 constants 和 CATEGORIES」这种粗规则 ——
// publish.js 合法地从 categories.js 取 CATEGORIES、从 constants.js 取 CONDITIONS，
// 会被误判（此规则曾误报一次）。
// 做法：按分号切成语句，逐条判断「这一条语句里既有 constants.js 又有 CATEGORIES」。
function importsCatFromConstants(src) {
  const stmts = String(src).replace(/\r/g, '').split(';');
  return stmts.some(s => /require\((['"])[^'"]*constants\.js\1\)/.test(s) && /\bCATEGORIES\b/.test(s));
}
const badImport = pagesJs.filter(p => importsCatFromConstants(read(p)));
check('无页面再从 constants 引入 CATEGORIES', badImport.length === 0, badImport.join(', ') || '干净');

const wxmlFiles = [];
(function walk2(dir) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const p = dir + '/' + f;
    const st = fs.statSync(path.join(root, p));
    if (st.isDirectory()) walk2(p);
    else if (f.endsWith('.wxml')) wxmlFiles.push(p);
  }
})('pages');

const directKey = wxmlFiles.filter(p => /\{\{\s*item\.category\s*\}\}/.test(read(p)));
check('无 wxml 直接渲染 item.category（英文key）', directKey.length === 0, directKey.join(', ') || '干净');

// ============ 4. 分类页四态互斥（结构检查）============
console.log('\n— 4. 分类页四态与左栏布局 —');
const catWxml = read('pages/category/category.wxml');
const catWxss = read('pages/category/category.wxss');
// 修复后的结构：首屏四态是「一条」wx:if/wx:elif/wx:elif + block wx:else
const firstChain = (catWxml.match(/wx:if="\{\{loading && !list\.length\}\}"[\s\S]*?<block wx:else>/) || [''])[0];
check('首屏四态为单链互斥（含 block wx:else）', firstChain.length > 0);
const hasElseBlock = /<block wx:else>/.test(catWxml);
check('存在 <block wx:else> 隔离「列表内翻页态」', hasElseBlock);
// 旧的错误写法：两个独立的 wx:if 链（都在 !list.length 判断之外）
const oldChain = /wx:if="\{\{loading\}\}"[\s\S]{0,200}wx:elif="\{\{hasMore\}\}"/.test(catWxml);
check('不存在「独立第二链」的旧写法', !oldChain || hasElseBlock, '（有 block 包裹即视为已修）');

// —— 左栏「滚到底露白」修复 ——
check('左栏有 .left-inner 内容容器（用于铺满背景）', /class="left-inner"/.test(catWxml));
check('.left-inner 设了 min-height:100%（消除底部空白）', /\.left-inner\s*\{[^}]*min-height:\s*100%/.test(catWxss));
check('左栏已移除 :nth-child 倾斜（改为 JS 算角度）', !/\.left-item:nth-child/.test(catWxss));
check('图标倾斜走 CSS 变量 --tilt', /--tilt/.test(catWxss) && /--tilt/.test(catWxml));
const catJsSrc = read('pages/category/category.js');
check('JS 为每个分类算好 tilt', /tiltOf\(i\)/.test(catJsSrc) && /TILTS/.test(catJsSrc));

// —— 左栏自动滚动到选中项（10 项超一屏，必须能定位）——
check('scroll-view 绑定 scroll-into-view', /scroll-into-view="\{\{scrollIntoView\}\}"/.test(catWxml));
check('分类项有 id（与 scrollIntoView 对应）', /id="cat-\{\{item\.key \|\| 'all'\}\}"/.test(catWxml));
check('JS 用 scrollIdOf 统一拼 id（空 key 兜底 all）', /scrollIdOf/.test(catJsSrc));
check('「全部」key 为空串时 id 不为空', /\(key \|\| 'all'\)/.test(catJsSrc));

// ============ 5. 分类页防竞态 ============
console.log('\n— 5. 分类页防竞态 —');
const catJs = catJsSrc; // 已在上方读取，复用同一份内容
check('存在切换节流（SWITCH_THROTTLE_MS）', /SWITCH_THROTTLE_MS/.test(catJs));
check('存在请求令牌（_reqToken）', /_reqToken/.test(catJs));
check('过期请求结果被丢弃', /token !== this\._reqToken/.test(catJs));
check('走统一 catName（无本地映射）', /catName/.test(catJs) && !/CATEGORIES\.find/.test(catJs));

// ============ 6. 云函数：categoryText 下发 + 白名单校验 ============
console.log('\n— 6. 云函数 —');
const goodsFn = read('cloudfunctions/goods/index.js');
check('goods 下发 categoryText', /categoryText: categoryText\(g\.category\)/.test(goodsFn));
check('goods.publish 校验 category 白名单', /CATEGORY_MAP\[category\]/.test(goodsFn));
check('goods.update 校验 category 白名单', /CATEGORY_MAP\[patch\.category\]/.test(goodsFn));
const adminFn = read('cloudfunctions/admin/index.js');
check('admin 下发 categoryText', /categoryText: categoryTextOf\(g\.category\)/.test(adminFn));

// 云函数内的 CATEGORY_MAP 必须与前端 CATEGORIES 一致（云函数无法 require 前端模块，故内联）
function extractMap(src) {
  const seg = (src.match(/const CATEGORY_MAP = \{([\s\S]*?)\};/) || [, ''])[1];
  const o = {};
  const r = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']+)'/g;
  let x;
  while ((x = r.exec(seg)) !== null) o[x[1]] = x[2];
  return o;
}
const expect = {};
CATEGORIES.forEach(c => { expect[c.key] = c.name; });
check('goods 内联 CATEGORY_MAP 与前端一致',
  JSON.stringify(extractMap(goodsFn)) === JSON.stringify(expect));
check('admin 内联 CATEGORY_MAP 与前端一致',
  JSON.stringify(extractMap(adminFn)) === JSON.stringify(expect));

// ============ 7. 详情页 / 后台页 改用 categoryText ============
console.log('\n— 7. 展示层 —');
check('detail.wxml 用 categoryText', /\{\{categoryText\}\}/.test(read('pages/detail/detail.wxml')));
check('detail.js 派生 categoryText', /categoryText/.test(read('pages/detail/detail.js')));
check('admin-goods.wxml 用 categoryText', /item\.categoryText/.test(read('pages/admin-goods/admin-goods.wxml')));
check('admin-goods.js 派生 categoryText', /categoryText:/.test(read('pages/admin-goods/admin-goods.js')));

// ============ 8. 废弃 API：不得再调用 wx.getSystemInfoSync ============
// 背景：nav-bar 组件被 21 个页面复用，过去在 attached 里调 wx.getSystemInfoSync()，
// 每进一个页面就在调试器刷一条「getSystemInfoSync is deprecated」警告，
// 表现为「调试器 N 个报错」。统一改用最小粒度的新 API：
//   窗口/状态栏尺寸 → wx.getWindowInfo()
//   机型/平台       → wx.getDeviceInfo()
//   SDK/基础库/主题 → wx.getAppBaseInfo()
console.log('\n— 8. 废弃 API 检查 —');
const runJs = [];
(function walk3(dir) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (f === 'node_modules') continue;
    const p = dir + '/' + f;
    const st = fs.statSync(path.join(root, p));
    if (st.isDirectory()) walk3(p);
    else if (f.endsWith('.js')) runJs.push(p);
  }
})('.');
// tools/ 与 scripts/ 自带脚本允许出现关键字（用作噪声过滤正则），只查小程序运行时代码
// 注意 walk3 拼出的路径带 './' 前缀（如 './tools/x.js'），过滤时要一并剥掉，
// 否则会把 tools 目录误判成运行时代码 —— 这类自校验脚本自身经常提到旧 API 名。
// 注释行也跳过（说明性文字里提到旧 API 名是正常的）。
const norm = p => p.replace(/\\/g, '/').replace(/^\.\//, '');
const runtimeJs = runJs.filter(p => !/^(tools|scripts|node_modules)\//.test(norm(p)));
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
const deprecated = runtimeJs.filter(p => /wx\.getSystemInfoSync\s*\(/.test(stripComments(read(p))));
check('运行时无 wx.getSystemInfoSync 直接调用（注释除外）',
  deprecated.length === 0,
  deprecated.join(', ') || '干净');
check('nav-bar 改用 wx.getWindowInfo（无废弃 API 回退路径）',
  /wx\.getWindowInfo\(\)/.test(read('components/nav-bar/nav-bar.js')));

// ============ 9. 自定义 tabBar：高度口径统一 ============
// 踩坑记录：--tabbar-h 原先写 110rpx，但按 custom-tab-bar/index.wxss 逐条累加实测是 114rpx
// （边框2×4 + item padding 14+16 + 图标46 + gap6 + 文字行高24），
// 加上未读角标 top:-14rpx 的上溢，取 120rpx 才够。
// 同时 4 个页面把 110rpx 硬编码在 calc() 里，只有 publish 用了变量 ——
// 一旦 tabBar 改样式，硬编码的地方不会跟着变，就会出现「内容被 tabBar 盖住/露缝」。
console.log('\n— 9. 自定义 tabBar 高度口径 —');
const appWxss = read('app.wxss');
const tabbarH = (appWxss.match(/--tabbar-h:\s*(\d+)rpx/) || [, ''])[1];
check('app.wxss 定义了 --tabbar-h', !!tabbarH, tabbarH ? tabbarH + 'rpx' : '未定义');
check('--tabbar-h 与 tabBar 实测高度一致（>=114rpx 且留角标余量）',
  Number(tabbarH) >= 114, `当前 ${tabbarH}rpx（实测 114rpx + 角标余量）`);

const pageWxss = [];
(function walk4(dir) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const p = dir + '/' + f;
    const st = fs.statSync(path.join(root, p));
    if (st.isDirectory()) walk4(p);
    else if (f.endsWith('.wxss')) pageWxss.push(p);
  }
})('pages');
// 找把旧值硬编码进 calc() 的地方（注释里提到数字不算）
const hardcoded = pageWxss.filter(p => /calc\(\s*110rpx\s*\+/.test(read(p)));
check('无页面把 110rpx 硬编码进 calc()（应用 var(--tabbar-h)）',
  hardcoded.length === 0, hardcoded.join(', ') || '干净');
const usesVar = pageWxss.filter(p => /var\(--tabbar-h\)/.test(read(p)));
check('用到 tabBar 留白的页面都走 var(--tabbar-h)',
  usesVar.length >= 5, `${usesVar.length} 个页面`);

// ============ 10. 孤儿 class / 孤立 CSS 变量 ============
// 踩坑记录：custom-tab-bar/index.wxml 里长期留着一个 <view class="tab-pill">，
// 但全项目没有任何 .tab-pill 样式 —— 典型的改版残留（多包一层无用节点 + 误导后人）。
console.log('\n— 10. 孤儿 class 与孤立变量 —');
const compWxml = read('custom-tab-bar/index.wxml');
check('custom-tab-bar 无无样式的 tab-pill 残留', !/tab-pill/.test(compWxml));
check('tabBar 高度结构为 item > ico-wrap + txt（无多余包裹层）',
  /class="tab-ico-wrap"/.test(compWxml) && !/tab-pill/.test(compWxml));

// wxml 里内联设置的 CSS 变量，必须能在对应 wxss / app.wxss 里找到消费者
const wxmlList = [];
(function walk5(dir) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const p = dir + '/' + f;
    const st = fs.statSync(path.join(root, p));
    if (st.isDirectory()) walk5(p);
    else if (f.endsWith('.wxml')) wxmlList.push(p);
  }
})('pages');
const orphanVars = [];
wxmlList.forEach(p => {
  const src = read(p);
  const set = new Set();
  const re = /style="[^"]*--([a-zA-Z0-9_-]+)\s*:/g;
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  const css = p.replace(/\.wxml$/, '.wxss');
  const cssSrc = fs.existsSync(path.join(root, css)) ? read(css) : '';
  set.forEach(v => {
    if (!cssSrc.includes('var(--' + v) && !appWxss.includes('var(--' + v)) {
      orphanVars.push(`${p} 设了 --${v} 但无人消费`);
    }
  });
});
check('wxml 内联 CSS 变量都有消费者', orphanVars.length === 0,
  orphanVars.join('; ') || '干净');

// ============ 11. 页面根容器 .page 基线 ============
// 踩坑记录：26 个页面里 23 个各自写了 `.page`，agreement / credit / privacy
// 三个页面**完全没写** —— 它们的长内容直接贴到屏幕底边，被全面屏 Home 指示条压住。
// 另有 login 写 `padding: 32rpx`，把安全区整条覆盖掉。
// 结论：.page 必须在 app.wxss 有一份全局基线，页面只覆写差异。
console.log('\n— 11. 页面根容器基线 —');
check('app.wxss 定义了 .page 全局基线', /^\.page\s*\{/m.test(appWxss));
check('.page 基线含底部安全区',
  /^\.page\s*\{[^}]*env\(safe-area-inset-bottom\)/m.test(appWxss));

// 每个根节点用 class="page" 的页面，其 wxss 若有 .page 覆写，必须显式处理底部。
const rootPageWxss = [];
(function walk6(dir) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const p = dir + '/' + f;
    const st = fs.statSync(path.join(root, p));
    if (st.isDirectory()) walk6(p);
    else if (f.endsWith('.wxml')) {
      const first = read(p).trimStart();
      if (/^<view\s+class="page"/.test(first) || /class="page"/.test(first.split('\n')[0])) {
        rootPageWxss.push(p);
      }
    }
  }
})('pages');
const noSafeArea = [];
rootPageWxss.forEach(p => {
  const css = p.replace(/\.wxml$/, '.wxss');
  if (!fs.existsSync(path.join(root, css))) return;
  const src = read(css);
  const seg = (src.match(/^\.page\s*\{([\s\S]*?)\}/m) || [, ''])[1];
  if (!seg) return; // 没覆写 → 走全局基线，安全
  // 显式处理过底部的情况：safe-area / tabbar-h / flex 整屏（chatroom）
  const ok = /safe-area-inset-bottom/.test(seg) || /var\(--tabbar-h\)/.test(seg)
    || /height:\s*100vh/.test(seg);
  if (!ok) noSafeArea.push(css);
});
check('覆写 .page 的页面都显式处理了底部安全区',
  noSafeArea.length === 0, noSafeArea.join(', ') || `检查了 ${rootPageWxss.length} 个页面`);

// ============ 汇总 ============
const failed = results.filter(r => !r.pass);
console.log('\n================ 汇总 ================');
results.forEach(r => console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : '  ← ' + (r.detail || '')}`));
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
