// 临时审计脚本：检查 wxml 绑定的处理函数在 js 里是否存在
const fs = require('fs'), path = require('path');
const base = 'D:/商城/pages';
const issues = [];
for (const dir of fs.readdirSync(base)) {
  const p = path.join(base, dir);
  if (!fs.statSync(p).isDirectory()) continue;
  const wxml = path.join(p, dir + '.wxml');
  const js = path.join(p, dir + '.js');
  if (!fs.existsSync(wxml) || !fs.existsSync(js)) continue;
  const w = fs.readFileSync(wxml, 'utf8');
  const j = fs.readFileSync(js, 'utf8');
  const handlers = new Set();
  for (const m of j.matchAll(/^\s{2,}(?:async\s+)?([A-Za-z_]\w*)\s*[(:]/gm)) handlers.add(m[1]);
  for (const m of w.matchAll(/(?:bind|catch)[a-z]*=["']([A-Za-z_]\w*)["']/g)) {
    if (!handlers.has(m[1])) issues.push(dir + '.wxml: 缺少处理函数 ' + m[1]);
  }
}
console.log(issues.length ? issues.join('\n') : 'ALL_HANDLERS_OK');
