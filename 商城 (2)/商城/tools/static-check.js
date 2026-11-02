// 静态检查：wxml 标签配平 + wx:if/elif/else 配对 + bind 方法引用 + usingComponents 路径
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/商城';
const pagesDir = path.join(ROOT, 'pages');
const problems = [];

// ---------- 1. wxml 标签配平 + wx:if 配对 ----------
function checkWxml(file) {
  const src = fs.readFileSync(file, 'utf8');
  // 去注释
  const s = src.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
  const voidOk = new Set(['input', 'image', 'import', 'include', 'wxs']);
  let m, line = 1;
  const lineOf = idx => s.slice(0, idx).split('\n').length;
  while ((m = tagRe.exec(s)) !== null) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClose = m[4] === '/' || voidOk.has(name) && !closing;
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) {
        problems.push(`${path.relative(ROOT, file)}:${lineOf(m.index)} 意外的 </${name}>（栈顶是 ${top ? top.name : '空'}）`);
        return;
      }
    } else if (!selfClose) {
      stack.push({ name, idx: m.index });
    }
  }
  if (stack.length) {
    problems.push(`${path.relative(ROOT, file)}:${lineOf(stack[0].idx)} <${stack[0].name}> 未闭合`);
  }
  // wx:else / wx:elif 必须跟同层 wx:if / wx:elif —— 向前回溯 20 行内找
  const lines = src.split('\n');
  lines.forEach((ln, i) => {
    if (/wx:(else|elif)/.test(ln) && !/wx:(if|elif)/.test(ln)) {
      let ok = false;
      for (let k = i - 1; k >= Math.max(0, i - 20); k--) {
        if (/wx:(if|elif)/.test(lines[k])) { ok = true; break; }
      }
      if (!ok) {
        problems.push(`${path.relative(ROOT, file)}:${i + 1} 可疑的 wx:else/elif 位置（前 20 行无 wx:if/elif）`);
      }
    }
  });
}

// ---------- 2. wxml bind 方法在 js 中存在 ----------
function checkHandlers(pageName) {
  const wxmlFile = path.join(pagesDir, pageName, pageName + '.wxml');
  const jsFile = path.join(pagesDir, pageName, pageName + '.js');
  if (!fs.existsSync(wxmlFile) || !fs.existsSync(jsFile)) return;
  const wxml = fs.readFileSync(wxmlFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const js = fs.readFileSync(jsFile, 'utf8');
  const handlerRe = /(?:bind|catch)(?:[a-zA-Z]+)?[:=]?"([a-zA-Z_][\w]*)"/g;
  let m;
  const found = new Set();
  while ((m = handlerRe.exec(wxml)) !== null) found.add(m[1]);
  // bind:action 这种自定义事件（empty 组件等）
  const customRe = /bind:([\w-]+)="([\w]+)/g;
  while ((m = customRe.exec(wxml)) !== null) found.add(m[2]);
  [...found].forEach(h => {
    // js 中应该有 h( 或 h: 或 h = 形式的方法定义
    const defRe = new RegExp(`(^|[^\\w])${h}\\s*\\(`);
    if (!defRe.test(js)) {
      problems.push(`pages/${pageName}/${pageName}.wxml 引用了 ${h}() 但 js 中未定义`);
    }
  });
}

// ---------- 3. usingComponents 路径存在 ----------
function checkJson(pageName) {
  const jsonFile = path.join(pagesDir, pageName, pageName + '.json');
  if (!fs.existsSync(jsonFile)) return;
  let json;
  try { json = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch (e) {
    problems.push(`pages/${pageName}/${pageName}.json JSON 解析失败: ${e.message}`);
    return;
  }
  const comps = json.usingComponents || {};
  Object.entries(comps).forEach(([k, v]) => {
    const compPath = v.startsWith('/') ? path.join(ROOT, v.slice(1)) : path.resolve(path.dirname(jsonFile), v);
    if (!fs.existsSync(compPath + '.js')) {
      problems.push(`pages/${pageName}/${pageName}.json 组件 ${k} 路径不存在: ${v}`);
    }
  });
}

// ---------- 4. app.json 页面都存在 + 组件自身检查 ----------
function checkApp() {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  app.pages.forEach(p => {
    ['js', 'wxml', 'json'].forEach(ext => {
      if (!fs.existsSync(path.join(ROOT, p + '.' + ext))) {
        problems.push(`app.json 页面 ${p} 缺少 .${ext} 文件`);
      }
    });
  });
  if (app.subPackages) app.subPackages.forEach(sp => sp.pages.forEach(p => {
    ['js', 'wxml', 'json'].forEach(ext => {
      if (!fs.existsSync(path.join(ROOT, sp.root + '/' + p + '.' + ext))) {
        problems.push(`分包 ${sp.root}/${p} 缺少 .${ext}`);
      }
    });
  }));
}

fs.readdirSync(pagesDir).forEach(d => {
  const stat = fs.statSync(path.join(pagesDir, d));
  if (!stat.isDirectory()) return;
  const wxml = path.join(pagesDir, d, d + '.wxml');
  if (fs.existsSync(wxml)) {
    checkWxml(wxml);
    checkHandlers(d);
    checkJson(d);
  }
});
// 组件也查
fs.readdirSync(path.join(ROOT, 'components')).forEach(d => {
  const wxml = path.join(ROOT, 'components', d, d + '.wxml');
  if (fs.existsSync(wxml)) checkWxml(wxml);
});
checkApp();

console.log(`\n===== 检查完成：${problems.length} 个问题 =====`);
problems.forEach(p => console.log('  ' + p));
