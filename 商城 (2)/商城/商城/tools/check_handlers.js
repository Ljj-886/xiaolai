// tools/check_handlers.js
// 静态校验：WXML 里 bind*/catch* 引用的 handler，是否都在对应 JS 里定义了。
//
// 为什么需要它：小程序里 **绑定一个不存在的 handler 不会报错**，
// 只是该事件静默失效 —— 例如 `binderror="onAvatarErr"` 漏写 JS 实现，
// 图片加载失败时兜底逻辑完全不执行，页面上看不到任何异常。
// 实测一次抓出 4 个缺失（onAvatarErr / onSellerAvatarErr / onGoodsCoverErr / onPeerAvatarErr）。
//
// 用法：node tools/check_handlers.js
// 退出码：0 = 全部存在；1 = 有缺失

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'components')).concat(walk(path.join(ROOT, 'pages')));
const wxmls = files.filter(f => f.endsWith('.wxml'));
const problems = [];
let checked = 0;

for (const wxml of wxmls) {
  const js = wxml.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(js)) continue;
  const wxSrc = fs.readFileSync(wxml, 'utf8');
  const jsSrc = fs.readFileSync(js, 'utf8');

  const handlers = [...new Set(
    [...wxSrc.matchAll(/(?:bind|catch)(?::)?[a-z]+="([A-Za-z_$][\w$]*)"/g)].map(m => m[1])
  )];

  for (const h of handlers) {
    checked++;
    // 定义形态：h(...)  /  h: fn  /  h = fn   /  'h'(...)（对象简写/字符串键）
    const defined =
      jsSrc.includes(h + '(') ||
      jsSrc.includes(h + ':') ||
      jsSrc.includes(h + ' =') ||
      jsSrc.includes("'" + h + "'") ||
      jsSrc.includes('"' + h + '"');
    if (!defined) {
      problems.push({ wxml: path.relative(ROOT, wxml), handler: h });
    }
  }
}

console.log(`检查了 ${wxmls.length} 个 wxml，共 ${checked} 个事件绑定引用。`);
if (!problems.length) {
  console.log('✅ 所有 bind*/catch* handler 均已在对应 JS 中定义。');
  process.exit(0);
}
console.log(`\n❌ 发现 ${problems.length} 个未定义的 handler（事件会静默失效）：`);
problems.forEach(p => console.log(`   ${p.wxml}  →  ${p.handler}`));
process.exit(1);
