// tools/apply_button_spec.js —— 把全站「按键/选择器/图标按钮」统一到贴纸风按钮规范
//
// 规范（与 app.wxss 的 .btn / .btn-sm / .seg 一致）：
//   选择器未选中 = 白底 + 3rpx 深棕描边 + --ink-2 字
//   选择器选中   = 珊瑚实底 + 白字 + 3rpx 深棕描边
//   统一高度 60rpx / 全圆角 30rpx / 左右内边距 28rpx / 字号 26rpx
//   图标按钮     = 圆角 + 深棕描边；按压用缩放
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BK = path.join(ROOT, 'tools', '_button_backup');
fs.mkdirSync(BK, { recursive: true });

// 规范片段
const SEG = `  display: inline-flex; align-items: center; justify-content: center;
  height: 60rpx; padding: 0 28rpx; border-radius: 30rpx;
  font-size: 26rpx; line-height: 1; font-weight: 500;
  color: var(--ink-2); background: #fff;
  border: 3rpx solid var(--ink);
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;`;
const SEG_ON = `  background: var(--primary); color: #fff;`;
const SEG_ON_FLEX = `  background: var(--primary); color: #fff; font-weight: 500;`;

const tasks = [
  // ---- 搜索页筛选片 ----
  ['pages/search/search.wxss', [
    [`.chip {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 8rpx 22rpx; border-radius: 28rpx;
  background: #f2eadc; color: var(--text-2); font-size: 24rpx;
  border: 3rpx solid var(--ink);
  line-height: 1.4;
}`, `.chip {
${SEG}
}`],
    ['.chip.on { background: #e8542f; color: #fff; }', `.chip.on {
${SEG_ON}
  border-color: var(--primary);
}`],
    ['.chip.reset { background: #fff; border: 3rpx solid var(--ink); color: var(--text-2); }', '.chip.reset { background: #fff; border: 3rpx solid var(--ink); color: var(--ink-2); }']
  ]],
  // ---- 发布页分类胶囊 ----
  ['pages/publish/publish.wxss', [
    [`.cat-pill {
  padding: 12rpx 24rpx; border-radius: 30rpx;
  background: #f5eada; color: var(--text-2); font-size: 24rpx;
  border: 3rpx solid var(--ink);
  display: inline-flex; align-items: center; gap: 6rpx;
}`, `.cat-pill {
${SEG}
  gap: 6rpx;
}`],
    ['.cat-pill.active { background: var(--primary); color: #fff; border-color: var(--ink); }', `.cat-pill.active {
${SEG_ON}
  border-color: var(--ink);
}`]
  ]],
  // ---- 评价页标签 ----
  ['pages/review/review.wxss', [
    [`.tag-pill {
  padding: 12rpx 24rpx; border-radius: 30rpx;
  background: #f5eada; color: var(--text-2); font-size: 24rpx;
}`, `.tag-pill {
${SEG}
}`],
    ['.tag-pill.active { background: var(--primary); color: #fff; }', `.tag-pill.active {
${SEG_ON}
  border-color: var(--primary);
}`]
  ]],
  // ---- 审核中心分段控件 ----
  ['pages/admin-reviews/admin-reviews.wxss', [
    [`.seg-item {
  flex: 1; text-align: center; padding: 12rpx 0; font-size: 26rpx;
  color: var(--text-2); border-radius: 26rpx;
}`, `.seg-item {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  height: 60rpx; padding: 0 16rpx; margin: 0 6rpx; border-radius: 30rpx;
  font-size: 26rpx; line-height: 1;
  color: var(--ink-2); background: #fff;
  border: 3rpx solid var(--ink);
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}`],
    ['.seg-item.on { background: var(--primary-light); color: var(--primary); font-weight: 600; }', `.seg-item.on {
${SEG_ON_FLEX}
  border-color: var(--primary);
}`]
  ]],
  // ---- 首页 闲置/求购 切换 ----
  ['pages/index/index.wxss', [
    [`.type-switch-item {
  padding: 10rpx 28rpx; border-radius: 30rpx; font-size: 26rpx; color: var(--text-2); font-weight: 500;
}`, `.type-switch-item {
${SEG}
}`],
    ['.type-switch-item.active { background: #fff; color: var(--primary); font-weight: 600; border: 3rpx solid var(--ink); }', `.type-switch-item.active {
${SEG_ON}
  border-color: var(--primary);
}`]
  ]],
  // ---- 发布页 出售/求购 切换 ----
  ['pages/publish/publish.wxss', [
    [`.type-tab {
  flex: 1; text-align: center; padding: 18rpx 0; border-radius: 12rpx;
  font-size: 28rpx; color: var(--text-2); font-weight: 500;
}`, `.type-tab {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  height: 76rpx; margin: 0 6rpx; border-radius: 38rpx;
  font-size: 28rpx; line-height: 1;
  color: var(--ink-2); background: #fff;
  border: 3rpx solid var(--ink);
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}`],
    ['.type-tab.active { background: #fff; color: var(--primary); font-weight: 600; border: 3rpx solid var(--ink); }', `.type-tab.active {
${SEG_ON_FLEX}
  border-color: var(--primary);
}`]
  ]],
  // ---- 分类页排序栏：下划线改为统一的药丸选中态 ----
  ['pages/category/category.wxss', [
    [`.filter-item {
  flex: 1; text-align: center; padding: 24rpx 0;
  font-size: 26rpx; color: var(--text-2);
  position: relative;
}`, `.filter-item {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  height: 60rpx; margin: 12rpx 6rpx; border-radius: 30rpx;
  font-size: 26rpx; line-height: 1;
  color: var(--ink-2); background: #fff;
  border: 3rpx solid var(--ink);
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}`],
    [`.filter-item.active { color: var(--primary); font-weight: 500; }
.filter-item.active::after {
  content: ''; position: absolute; bottom: 0; left: 50%;
  transform: translateX(-50%); width: 48rpx; height: 4rpx;
  background: var(--primary); border-radius: 4rpx;
}`, `.filter-item.active {
${SEG_ON_FLEX}
  border-color: var(--primary);
}`]
  ]],
  // ---- 我的商品 tab ----
  ['pages/sold/sold.wxss', [
    [`.tab {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6rpx;
  padding: 16rpx 8rpx;
  border-radius: 12rpx;
  font-size: 28rpx;
  color: var(--text-3);
}`, `.tab {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6rpx;
  height: 60rpx; margin: 10rpx 6rpx; padding: 0 8rpx;
  border-radius: 30rpx;
  font-size: 26rpx; line-height: 1;
  color: var(--ink-2); background: #fff;
  border: 3rpx solid var(--ink);
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}`]
  ]],
  // ---- 聊天页：发送按钮 / 图标按钮 / 表情分组 ----
  ['pages/chatroom/chatroom.wxss', [
    [`.send-btn {
  background: #e8dcc6; color: #fff;
  padding: 14rpx 28rpx; border-radius: 32rpx;
  font-size: 26rpx;
  flex-shrink: 0;
}`, `.send-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 60rpx; padding: 0 30rpx; border-radius: 30rpx;
  font-size: 26rpx; line-height: 1; font-weight: 500;
  color: #fff; background: #D8C6AA;
  border: 3rpx solid var(--ink);
  flex-shrink: 0;
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}`],
    [`.icon-btn {
  width: 64rpx; height: 64rpx; line-height: 64rpx; text-align: center;
  font-size: 36rpx;
  flex-shrink: 0;
}`, `.icon-btn {
  width: 64rpx; height: 64rpx; line-height: 64rpx; text-align: center;
  font-size: 34rpx;
  border-radius: 50%;
  background: #fff; border: 3rpx solid var(--ink);
  flex-shrink: 0;
  transition: transform .08s ease;
}`],
    [`.emoji-tab {
  /* padding/border-radius 过大导致文字宽度超过药丸的"直边区"，
     第一个 active tab「笑脸」左半被圆角裁掉。缩小让 2 字能完整放下 */
  padding: 8rpx 16rpx; font-size: 26rpx;
  background: #f5eada; color: var(--text-2);
  border-radius: 16rpx; white-space: nowrap;
  flex-shrink: 0;
}`, `.emoji-tab {
  /* padding/border-radius 过大导致文字宽度超过药丸的"直边区"，
     第一个 active tab「笑脸」左半被圆角裁掉。这里用 16rpx 圆角避免裁切 */
  display: inline-flex; align-items: center; justify-content: center;
  height: 52rpx; padding: 0 18rpx; font-size: 26rpx; line-height: 1;
  background: #fff; color: var(--ink-2);
  border: 3rpx solid var(--ink);
  border-radius: 16rpx; white-space: nowrap;
  flex-shrink: 0;
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}`]
  ]],
  // ---- 发布页图片操作按钮 ----
  ['pages/publish/publish.wxss', [
    [`.image-add {
  aspect-ratio: 1;
  border: 2rpx dashed #d8c6aa; border-radius: 12rpx;`, `.image-add {
  aspect-ratio: 1;
  background: #fff;
  border: 3rpx dashed var(--ink); border-radius: 16rpx;`],
    [`.image-remove {
  position: absolute; top: 6rpx; right: 6rpx;
  width: 40rpx; height: 40rpx; line-height: 40rpx; text-align: center;
  background: rgba(0,0,0,0.6); color: #fff; border-radius: 50%;
  font-size: 24rpx;
}`, `.image-remove {
  position: absolute; top: 6rpx; right: 6rpx;
  width: 44rpx; height: 44rpx; line-height: 40rpx; text-align: center;
  background: rgba(0,0,0,0.62); color: #fff; border-radius: 50%;
  border: 3rpx solid var(--ink);
  font-size: 24rpx;
}`]
  ]],
  // ---- 详情页底部主 CTA：对齐 .btn-primary ----
  ['pages/detail/detail.wxss', [
    [`.btn-buy {
  flex: 1; height: 80rpx; line-height: 80rpx;
  text-align: center; color: #fff;
  background: #e8542f;
  border-radius: 40rpx; font-size: 28rpx;
  box-shadow: none;
}`, `.btn-buy {
  flex: 1; height: 88rpx; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  color: #fff; background: var(--primary);
  border: 4rpx solid var(--ink);
  border-right-width: 8rpx; border-bottom-width: 8rpx;
  border-radius: 44rpx; font-size: 30rpx; font-weight: 500;
  transition: transform .08s ease, border-width .08s ease, background-color .08s ease;
}`]
  ]]
];

let totalOK = 0, totalMiss = [];
for (const [file, pairs] of tasks) {
  const abs = path.join(ROOT, file);
  let s = fs.readFileSync(abs, 'utf8');
  const orig = s;
  fs.writeFileSync(path.join(BK, file.replace(/[\\/]/g, '__')), orig); // 备份
  let ok = 0;
  for (const [from, to] of pairs) {
    if (s.indexOf(from) >= 0) { s = s.replace(from, to); ok++; }
    else totalMiss.push(file + '  ← 未匹配: ' + from.split('\n')[0].slice(0, 46));
  }
  if (s !== orig) fs.writeFileSync(abs, s);
  console.log('  ' + ok + '/' + pairs.length + '  ' + file);
  totalOK += ok;
}
console.log('\n合计命中 ' + totalOK + ' 处');
if (totalMiss.length) { console.log('未匹配：'); totalMiss.forEach(m => console.log('  ❌ ' + m)); }
console.log('原文件已备份到 tools/_button_backup/');
