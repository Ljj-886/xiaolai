// tools/inventory_buttons.js —— 清点全项目的「按键 / 可点元素」，作为统一样式的依据
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = [];
for (const dir of ['pages', 'components', 'custom-tab-bar']) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.wxml')) files.push(p);
    }
  })(abs);
}

const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

// ---------- 1) <button> 元素 ----------
console.log('===== 一、<button> 元素 =====');
let nb = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/<button/.test(l)) {
      nb++;
      console.log('  ' + rel(f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 120));
    }
  });
}
console.log('  小计 ' + nb + ' 个 <button>');

// ---------- 2) 可点元素的静态 class 频次 ----------
console.log('\n===== 二、可点元素（bindtap/catchtap）class 频次 TOP 32 =====');
const cls = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /<[a-z-]+[^>]*?(?:bindtap|catchtap)="[^"]+"[^>]*>/g;
  let m;
  while ((m = re.exec(src))) {
    const cm = m[0].match(/class="([^"]*)"/);
    if (!cm) continue;
    const first = cm[1].split(/\s+/).filter(x => x && x.indexOf('{') < 0)[0];
    if (!first) continue;
    cls.set(first, (cls.get(first) || 0) + 1);
  }
}
[...cls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32)
  .forEach(([k, v]) => console.log('  ' + String(v).padStart(3) + '  ' + k));

// ---------- 3) 疑似「按钮类」的 CSS 选择器 ----------
console.log('\n===== 三、样式表里疑似按钮的选择器（含 btn/button/tab/chip/pill/switch/filter/entry/action）=====');
const wxss = [];
for (const dir of ['pages', 'components', 'custom-tab-bar']) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.wxss')) wxss.push(p);
    }
  })(abs);
}
wxss.push(path.join(ROOT, 'app.wxss'));
const sel = new Map();
for (const f of wxss) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /^\.([A-Za-z0-9_-]*(?:btn|button|tab|chip|pill|switch|filter|entry|action|link|more)[A-Za-z0-9_-]*)/gm;
  let m;
  while ((m = re.exec(src))) {
    const k = m[1];
    if (!sel.has(k)) sel.set(k, new Set());
    sel.get(k).add(rel(f));
  }
}
[...sel.entries()].sort((a, b) => b[1].size - a[1].size)
  .forEach(([k, s]) => console.log('  ' + k + '   [' + [...s].length + ' 个文件] ' + [...s].slice(0, 3).join(', ')));
