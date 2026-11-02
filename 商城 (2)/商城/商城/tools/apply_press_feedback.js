// tools/apply_press_feedback.js —— 给「按键类」可点元素统一补上按压反馈
// 背景：小程序 view 的按压反馈要靠 hover-class（不是 :active），此前全项目几乎都没写，
//       所以点击几乎没有任何视觉反馈。本脚本按统一规范补齐。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 只给"像按钮"的类补反馈；纯导航行/单元格不动（避免整页到处都在动）
const BTN_TOKENS = /(^|[\s_-])(btn|chip|pill|seg|tab|filter|icon-btn|image-add|image-remove|plus-item|action|auth-row|send-btn|bar-icon|link-text|auth-link|todo-row|order-cell)/;

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

let touchedFiles = 0;
let injected = 0;
const detail = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let changed = false;
  const out = src.replace(/<([a-z-]+)([^>]*?(?:bindtap|catchtap)="[^"]+"[^>]*?)>/g, (whole, tag, attrs) => {
    if (/\bhover-class=/.test(attrs)) return whole;                 // 已有反馈，不动
    const cm = attrs.match(/\bclass="([^"]*)"/);
    if (!cm) return whole;
    // 动态类名（{{}}）里的状态修饰不算
    const statics = cm[1].split(/\s+/).filter(x => x && x.indexOf('{') < 0);
    if (!statics.some(c => BTN_TOKENS.test(c))) return whole;
    injected++;
    if (detail.length < 14) detail.push(path.relative(ROOT, f).split(path.sep).join('/') + '  →  ' + statics[0]);
    changed = true;
    return '<' + tag + attrs + ' hover-class="press" hover-stay-time="80">';
  });
  if (changed) { fs.writeFileSync(f, out); touchedFiles++; }
}

console.log('已补按压反馈：' + injected + ' 处，涉及 ' + touchedFiles + ' 个 wxml 文件');
console.log('示例：');
detail.forEach(d => console.log('  ' + d));
