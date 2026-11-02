// tools/apply_theme_sticker.js —— 把手绘贴纸风的配色应用到各页面 wxss
// 只做「颜色令牌映射」，不动任何结构与逻辑；输出每个文件的替换次数便于复核。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 顺序很重要：长 hex 必须排在短 hex 前面，且用负向先行断言避免 #eee 吃掉 #eeeeee
const MAP = [
  ['#ff6b35', '#e8542f'], // 品牌橙 → 珊瑚橙
  ['#ff8a5b', '#f2704a'],
  ['#e55a2b', '#c8421f'],
  ['#ffcdb8', '#f0d6c8'],
  ['#1a1a1a', '#3d2b1f'], // 正文黑 → 深棕
  ['#333333', '#4a382a'],
  ['#333', '#4a382a'],
  ['#555555', '#6b543f'],
  ['#555', '#6b543f'],
  ['#666666', '#8a6f55'],
  ['#666', '#8a6f55'],
  ['#888888', '#a08869'],
  ['#888', '#a08869'],
  ['#999999', '#b39b80'],
  ['#999', '#b39b80'],
  ['#f5f6f8', '#fff9ee'], // 冷灰底 → 奶油底
  ['#fafafa', '#fff9ee'],
  ['#f5f5f5', '#f5eada'],
  ['#f4f4f4', '#f5eada'],
  ['#f3f3f4', '#f5eada'],
  ['#efefef', '#f2eadc'],
  ['#f0f0f0', '#f0e4d0'],
  ['#eeeeee', '#f0e4d0'],
  ['#eee', '#f0e4d0'],
  ['#e5e5e5', '#e8dcc6'],
  ['#ececec', '#e8dcc6'],
  ['#dddddd', '#e8dcc6'],
  ['#ddd', '#e8dcc6'],
  ['#cccccc', '#d8c6aa'],
  ['#ccc', '#d8c6aa'],
  ['#c0c0c0', '#c9b49a']
];

function buildRe(hex) {
  const body = hex.slice(1);
  // 允许 3/6 位写法差异：整体匹配已写出的形式，并确保后面不是 hex 字符
  return new RegExp(hex.replace('#', '#') + '(?![0-9a-fA-F])', 'gi');
}

function listWxss(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) listWxss(p, out);
    else if (name.endsWith('.wxss')) out.push(p);
  }
  return out;
}

const files = [
  ...listWxss(path.join(ROOT, 'pages')),
  ...listWxss(path.join(ROOT, 'components'))
];

let grand = 0;
const changed = [];
for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  const before = src;
  let cnt = 0;
  for (const [from, to] of MAP) {
    const re = buildRe(from);
    src = src.replace(re, () => { cnt++; return to; });
  }
  if (src !== before) {
    fs.writeFileSync(f, src);
    changed.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), n: cnt });
    grand += cnt;
  }
}

changed.sort((a, b) => b.n - a.n);
console.log('已应用贴纸风配色的文件：');
changed.forEach(c => console.log(`  ${String(c.n).padStart(3)} 处  ${c.file}`));
console.log(`\n共 ${changed.length} 个文件，${grand} 处替换`);
