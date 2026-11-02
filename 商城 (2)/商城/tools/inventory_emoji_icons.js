// tools/inventory_emoji_icons.js —— 盘点全站「把 emoji 当 UI 图标用」的位置
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u;

function walk(dir, exts, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const n of fs.readdirSync(abs)) {
    const p = path.join(abs, n);
    if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') walk(path.relative(ROOT, p), exts, out); }
    else if (exts.some(e => n.endsWith(e))) out.push(p);
  }
  return out;
}

const targets = [...walk('pages', ['.wxml', '.js']), ...walk('components', ['.wxml']), ...walk('cloudfunctions/admin', ['.js'])];
const hits = [];
for (const f of targets) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (EMOJI.test(l)) hits.push({ f: path.relative(ROOT, f).split(path.sep).join('/'), line: i + 1, text: l.trim().slice(0, 96) });
  });
}
console.log('===== emoji 作为 UI 图标的使用点（' + hits.length + ' 处）=====');
let cur = '';
for (const h of hits) {
  if (h.f !== cur) { cur = h.f; console.log('\n【' + h.f + '】'); }
  console.log('  :' + h.line + '  ' + h.text);
}
