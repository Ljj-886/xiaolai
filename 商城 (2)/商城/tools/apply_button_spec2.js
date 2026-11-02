// tools/apply_button_spec2.js —— 第二批：管理后台 tab、图标按钮底托、分段容器
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BK = path.join(ROOT, 'tools', '_button_backup');
fs.mkdirSync(BK, { recursive: true });

const TAB_SPEC = `.tab {
  display: inline-flex; align-items: center; justify-content: center;
  height: 60rpx; padding: 0 30rpx; border-radius: 30rpx;
  font-size: 26rpx; line-height: 1;
  color: var(--ink-2); background: #fff;
  border: 3rpx solid var(--ink);
  margin-right: 10rpx;
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}
.tab.on { background: var(--primary); color: #fff; font-weight: 500; border-color: var(--primary); }`;

const files = ['pages/admin-goods/admin-goods.wxss', 'pages/admin-reviews/admin-reviews.wxss', 'pages/admin-users/admin-users.wxss'];

for (const file of files) {
  const abs = path.join(ROOT, file);
  let s = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(path.join(BK, file.replace(/[\\/]/g, '__')), s);
  const before = s;

  // .tab { ... } 与紧随其后的 .tab.on { ... } 归一为规范
  const re = /\.tab\s*\{[^}]*\}\s*\n\.tab\.on\s*\{[^}]*\}/;
  if (re.test(s)) s = s.replace(re, TAB_SPEC);
  else console.log('  ⚠️ 未匹配 .tab 规则: ' + file);

  // 分段容器 .seg 加深棕描边，与选择器同一视觉语言
  s = s.replace(/\.seg \{\s*display: flex;\s*background: #fff;\s*border-radius: 30rpx;\s*padding: 6rpx;/, '.seg {\n  display: flex; background: #fff; border: 3rpx solid var(--ink); border-radius: 30rpx; padding: 6rpx;');

  if (s !== before) { fs.writeFileSync(abs, s); console.log('  ✅ ' + file); }
}

// 「我的」页图标按钮：裸 emoji → 贴纸底托（与首页分类宫格同一视觉）
const mineAbs = path.join(ROOT, 'pages/mine/mine.wxss');
let mine = fs.readFileSync(mineAbs, 'utf8');
fs.writeFileSync(path.join(BK, 'pages__mine__mine.wxss'), mine);
const anchor = `.order-cell {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8rpx;
  color: var(--text-2); padding: 12rpx 0;
}`;
const replaced = `${anchor}
/* 图标按钮底托：与首页分类宫格、tabBar 图标同一套「描边贴纸」视觉 */
.order-cell .emoji {
  width: 76rpx; height: 76rpx; border-radius: 22rpx;
  display: flex; align-items: center; justify-content: center;
  background: #fff; border: 3rpx solid var(--ink);
  font-size: 34rpx; line-height: 1;
  transition: transform .08s ease, border-width .08s ease;
}`;
if (mine.indexOf(anchor) >= 0) { mine = mine.replace(anchor, replaced); fs.writeFileSync(mineAbs, mine); console.log('  ✅ pages/mine/mine.wxss（图标底托）'); }
else console.log('  ⚠️ 未匹配 .order-cell: pages/mine/mine.wxss');

console.log('\n完成。原文备份在 tools/_button_backup/');
