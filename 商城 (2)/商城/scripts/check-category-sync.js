// scripts/check-category-sync.js
// 校验 utils/icon.wxs 里的 CAT 表与 utils/categories.js 的 ICON_FILE 是否一致。
//
// 为什么需要：wxml 内联表达式无法 require JS 模块，所以 utils/icon.wxs 里
// 必须保留一份只读副本。副本一旦漂移，就会出现「新增了分类但分类页图标是空」这种
// 只在真机才发现的 bug。此脚本在本地跑，纯 Node，无需开发者工具。
//
// 用法：node scripts/check-category-sync.js
// 退出码：0 = 一致；1 = 不一致（可用于 CI / 提交前检查）

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { ICON_FILE, CATEGORY_KEYS } = require(path.join(root, 'utils', 'categories.js'));

const wxsPath = path.join(root, 'utils', 'icon.wxs');
const wxs = fs.readFileSync(wxsPath, 'utf8');

// 从 wxs 源文本里抽出 `key: 'cat_xxx'` 形式的映射，不 eval 它（wxs 不是标准 JS）
const wxsMap = {};
const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']+)'/g;
let m;
const body = (wxs.match(/var CAT = \{([\s\S]*?)\};/) || [, ''])[1];
while ((m = re.exec(body)) !== null) wxsMap[m[1]] = m[2];

const errors = [];

// ① 每个 JS 侧的 key 都要在 wxs 里有对应项，且文件名一致
Object.keys(ICON_FILE).forEach(k => {
  if (!(k in wxsMap)) errors.push(`icon.wxs 缺少分类 \`${k}\``);
  else if (wxsMap[k] !== ICON_FILE[k]) {
    errors.push(`\`${k}\` 图标不一致：categories.js=${ICON_FILE[k]} / icon.wxs=${wxsMap[k]}`);
  }
});

// ② 反向检查：wxs 里多余的项（已删除的分类残留）
Object.keys(wxsMap).forEach(k => {
  if (!(k in ICON_FILE)) errors.push(`icon.wxs 存在多余分类 \`${k}\`（categories.js 中已无此 key）`);
});

// ③ 每个分类的图标文件必须真实存在
const imgDir = path.join(root, 'images');
Object.keys(ICON_FILE).forEach(k => {
  const f = path.join(imgDir, ICON_FILE[k] + '.png');
  if (!fs.existsSync(f)) errors.push(`图标文件缺失：images/${ICON_FILE[k]}.png（分类 ${k}）`);
});

// ④ 分类数量自检
if (CATEGORY_KEYS.length !== Object.keys(ICON_FILE).length) {
  errors.push(`分类数与图标映射数不等：CATEGORIES=${CATEGORY_KEYS.length} / ICON_FILE=${Object.keys(ICON_FILE).length}`);
}

const label = '分类映射一致性';
if (errors.length) {
  console.error(`✗ ${label}校验失败（${errors.length} 处）`);
  errors.forEach(e => console.error('  · ' + e));
  process.exit(1);
}
console.log(`✓ ${label}校验通过：${CATEGORY_KEYS.length} 个分类的 key / 图标 / 素材三方一致`);
