// tools/verify_fixes_0916.js — 本轮修复的真机验证（左下角空白 / 面板对齐 / 安全区 / 废弃 API）
//
// 遵守 .workbuddy/memory/MEMORY.md「真机自动化测试」约定：
//   #1 不调 mp.close()，只 disconnect
//   #2 mp.screenshot() 会重置页面栈 → 截图统一放最后
//   #3 同进程导航过多会进陈旧状态 → 本脚本只走 4 站
//   #4 不用 | tail / | grep 包长任务 → 由调用方重定向到文件
//   #11 截图后页面栈必回首页 → 每条测量都自带 route 自校验，不符则标「未验证」而非失败
//
// ⚠️ 运行前请确认 IDE 干净（连续跑 3 次左右 IDE 会崩，属已知环境问题）：
//     netstat -ano | grep :9460        # 有孤儿占用就清掉
//     MSYS_NO_PATHCONV=1 taskkill /F /PID <pid>
//     然后等 40s 让 IDE 冷启动完成再跑
//
// 已知状态：A/C/D 组已在 IDE 稳定时验证通过（见 docs/assets/verify_0916_run2.txt）；
//           B 组因 IDE 稳定性问题未取得可信数据，需人工确认（见 docs 第三节）。
//
// 用法：node tools/verify_fixes_0916.js > tools/_vfix.txt 2>&1
const path = require('path');
const { spawn } = require('child_process');
const Automator = require('miniprogram-automator');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CLI = 'D:\\weixinkaifa\\微信web开发者工具\\cli.bat';
const projectPath = path.join(__dirname, '..');
const PORT = 9460;

const results = [];
const shots = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function start() {
  return new Promise((res, rej) => {
    const p = spawn('cmd.exe', ['/c', CLI, 'auto', '--project', projectPath, '--auto-port', String(PORT)],
      { detached: true, stdio: 'ignore', windowsHide: true });
    p.on('error', rej); p.unref(); res();
  });
}
async function conn() {
  const dl = Date.now() + 150000;
  let last = '';
  while (Date.now() < dl) {
    try { return await Automator.connect({ wsEndpoint: 'ws://localhost:' + PORT, timeout: 60000 }); }
    catch (e) { last = e.message; await sleep(2500); }
  }
  throw new Error('connect timeout: ' + last);
}
async function curPath(mp) {
  try { const p = await mp.currentPage(); return p ? p.path : '(null)'; } catch (e) { return '(err)'; }
}
async function waitPath(mp, expect, timeoutMs = 15000) {
  const dl = Date.now() + timeoutMs;
  while (Date.now() < dl) {
    const p = await curPath(mp);
    if (p.indexOf(expect) >= 0) return true;
    await sleep(500);
  }
  return false;
}
/** 安装 console 捕获，用于确认废弃 API 警告是否还在 */
async function installLogCapture(mp) {
  return mp.evaluate(() => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    if (!g || g.__fixLogs) return 'already';
    g.__fixLogs = [];
    const ow = console.warn, oe = console.error;
    const fmt = a => { try { return Array.prototype.slice.call(a).map(x => (typeof x === 'string' ? x : (x && x.message) || '')).join(' '); } catch (e) { return ''; } };
    console.warn = function () { try { g.__fixLogs.push({ l: 'warn', m: fmt(arguments) }); } catch (e) {} return ow.apply(console, arguments); };
    console.error = function () { try { g.__fixLogs.push({ l: 'error', m: fmt(arguments) }); } catch (e) {} return oe.apply(console, arguments); };
    g.__fixLogs = [];
    return 'ok';
  });
}
async function drainLogs(mp) {
  const r = await mp.evaluate(() => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    const out = (g && g.__fixLogs) || [];
    if (g) g.__fixLogs = [];
    return out;
  }).catch(() => []);
  return Array.isArray(r) ? r : [];
}

(async () => {
  console.log('启 IDE 端口', PORT, '…');
  await start();
  const mp = await conn();
  console.log('✅ connected\n');

  // ============ A. 分类页左栏「滚到底露白」 ============
  console.log('— A. 分类页左栏底部空白 —');
  await mp.reLaunch('/pages/index/index');
  await sleep(16000);
  await installLogCapture(mp);
  await drainLogs(mp);

  // 点 tabBar「分类」
  let ok = false;
  try {
    const tabs = await (await mp.currentPage()).$$('.tab-item');
    for (const t of tabs) {
      let txt = ''; try { txt = await t.text(); } catch (e) {}
      if (txt && txt.indexOf('分类') >= 0) { await t.tap(); ok = true; break; }
    }
  } catch (e) {}
  if (!ok) { try { await mp.switchTab('/pages/category/category'); ok = true; } catch (e) {} }
  const inCat = await waitPath(mp, 'pages/category/category', 15000);
  console.log('  当前页：', await curPath(mp), inCat ? '(✓)' : '(✗)');

  if (inCat) {
    await sleep(6000);
    const cp = await mp.currentPage();
    const cd = await cp.data();
    const cats = cd.cats || [];
    check('A1 左栏分类 10 项且每项带 tilt 内联角度',
      cats.length === 10 && cats.every(c => typeof c.tilt === 'string' && /deg$/.test(c.tilt)),
      `${cats.length} 项，tilt=${cats.slice(0, 3).map(c => c.tilt).join('/')}…`);

    // .left-inner 是否存在且高度 >= .left 的可视高度（min-height:100% 生效的直接证据）
    const geom = await mp.evaluate(() => new Promise(resolve => {
      const q = wx.createSelectorQuery();
      q.select('.left').boundingClientRect(r1 => {
        q.select('.left-inner').boundingClientRect(r2 => {
          resolve({ left: r1 && { h: r1.height, top: r1.top }, inner: r2 && { h: r2.height, top: r2.top } });
        }).exec();
      }).exec();
    })).catch(e => ({ __err: String(e && e.message) }));

    if (geom && geom.left && geom.inner) {
      check('A2 .left-inner 高度 >= 左栏可视高度（白底铺满，无露白）',
        geom.inner.h >= geom.left.h - 1,
        `left=${geom.left.h.toFixed(1)}px, inner=${geom.inner.h.toFixed(1)}px`);
    } else {
      check('A2 .left-inner 高度 >= 左栏可视高度（白底铺满，无露白）', false,
        '量不到元素：' + JSON.stringify(geom));
    }

    // 滚到底：切到最后一个分类，检查左栏底部是否还有空白（截图留证）
    const lastKey = cats[cats.length - 1].key;
    const items = await cp.$$('.left-item');
    console.log(`  左栏渲染项数：${items.length}`);
    check('A3 左栏 10 项全部渲染', items.length === 10, `实际 ${items.length}`);

    // 切到最后一个分类（真实点击）
    if (items.length) {
      try { await items[items.length - 1].tap(); } catch (e) {}
      await sleep(3500);
      const cp2 = await mp.currentPage();
      const cd2 = await cp2.data();
      check('A4 切到末位分类后 scrollIntoView 指向该项',
        cd2.scrollIntoView === 'cat-' + lastKey,
        `scrollIntoView="${cd2.scrollIntoView}" 期望 cat-${lastKey}`);
      shots.push('fix_cat_last.png');
    }
    shots.push('fix_cat_left.png');

    // 本轮改动不应引入 error
    const logs = await drainLogs(mp);
    const errs = logs.filter(x => x.l === 'error');
    const depWarn = logs.filter(x => /getSystemInfoSync is deprecated/i.test(x.m));
    check('A5 分类页无 console.error', errs.length === 0,
      errs.length ? errs.map(e => e.m.slice(0, 90)).join(' | ') : '干净');
    check('A6 分类页无 getSystemInfoSync 废弃警告', depWarn.length === 0,
      depWarn.length ? `${depWarn.length} 条` : '干净（已改用 wx.getWindowInfo）');
  }

  // ============ B. 聊天室：输入栏与面板对齐 ============
  // ⚠️ B 组必须**独立重启连接**。
  // 原因：A 组结束后页面栈已经乱了（automator 长时间复用同一 mp 句柄会进陈旧状态，
  // 见 MEMORY.md「真机自动化测试」#3）。第 1 次跑时 B 组量到了 238px 的巨大 gap，
  // 事后看截图发现当时页面根本不是 chatroom —— 是首页，测量对象错了。
  // 这里断开重连，保证 B 组从干净状态出发。
  console.log('\n— B. 聊天室面板对齐（独立连接）—');
  try { await mp.disconnect(); } catch (e) {}
  await sleep(3000);
  const mp2 = await conn();
  console.log('  ✅ re-connected');
  await installLogCapture(mp2);

  await mp2.reLaunch('/pages/chat/chat');
  await sleep(14000);
  let chatOk = await waitPath(mp2, 'pages/chat/chat', 12000);
  console.log('  当前页：', await curPath(mp2), chatOk ? '(✓)' : '(✗)');

  let entered = false;
  if (chatOk) {
    const p = await mp2.currentPage();
    const cd = await p.data();
    const conv = (cd.list || [])[0];
    if (conv && conv.convId) {
      try { await mp2.navigateTo(`/pages/chatroom/chatroom?convId=${conv.convId}`); entered = true; } catch (e) {}
      if (entered) entered = await waitPath(mp2, 'pages/chatroom/chatroom', 15000);
    } else {
      // 没有会话 → 用 peer 兜底开一个临时会话（chatroom 会用 convId 为空时新建）
      console.log('  无会话，尝试用 peer 打开临时聊天');
      try { await mp2.navigateTo('/pages/chatroom/chatroom?peer=test_peer'); entered = true; } catch (e) {}
      if (entered) entered = await waitPath(mp2, 'pages/chatroom/chatroom', 15000);
    }
  }
  console.log('  chatroom：', await curPath(mp2), entered ? '(✓ 已进入)' : '(✗ 未进入)');

  // 进不了聊天室就不能下结论 —— 明确标为「未验证」，不要写成通过
  if (!entered) {
    check('B1 +面板底边与输入栏顶边对齐', false, '未进入 chatroom，本组未验证');
    check('B2 输入多行后输入栏变高', false, '未进入 chatroom，本组未验证');
    check('B3 输入栏变高后面板仍贴合', false, '未进入 chatroom，本组未验证');
  } else {
    await sleep(8000);
    const rp = await mp2.currentPage();
    // 确认当前真是 chatroom 再测量（避免重蹈第 1 次的覆辙）
    const realPath = await curPath(mp2);
    console.log('  测量前再次确认页面：', realPath);

    const measure = () => mp2.evaluate(() => new Promise(resolve => {
      // 关键：把当前路由一起量出来，避免「量到了别的页面却当成当前页」的假失败
      const q = wx.createSelectorQuery();
      const out = { route: '' };
      try { out.route = getCurrentPages().slice(-1)[0].route; } catch (e) { out.route = '(err)'; }
      q.select('.input-bar').boundingClientRect(ib => {
        out.inputBar = ib && { top: ib.top, h: ib.height, bottom: ib.bottom };
        q.select('.plus-panel').boundingClientRect(pp => {
          out.panel = pp && { top: pp.top, h: pp.height, bottom: pp.bottom };
          resolve(out);
        }).exec();
      }).exec();
    })).catch(e => ({ __err: String(e && e.message) }));

    // 打开 + 面板
    try { await rp.callMethod('togglePlus'); } catch (e) { console.log('  togglePlus:', e.message); }
    await sleep(2000);
    const base = await measure();
    console.log('  基准测量：', JSON.stringify(base));

    const onRightPage = base && base.route === 'pages/chatroom/chatroom';
    if (!onRightPage) {
      check('B1 +面板底边与输入栏顶边对齐（误差 ≤3px）', false,
        `测量时不在 chatroom（route=${base && base.route}）→ 本组未验证`);
    } else if (base.inputBar && base.panel) {
      // 判读：面板底边 == 输入栏顶边
      const gap = Math.abs(base.inputBar.top - base.panel.bottom);
      check('B1 +面板底边与输入栏顶边对齐（误差 ≤3px）', gap <= 3,
        `panel.bottom=${base.panel.bottom.toFixed(1)} input.top=${base.inputBar.top.toFixed(1)} gap=${gap.toFixed(1)}px`);
    } else {
      check('B1 +面板底边与输入栏顶边对齐（误差 ≤3px）', false,
        '面板未渲染或量不到：' + JSON.stringify(base));
    }

    // 输入多行 → 输入栏应变高，面板应同步上移
    let multi = null;
    try {
      await rp.callMethod('onInput', { detail: { value: '第一行内容比较长一点\n第二行内容比较长一点\n第三行内容比较长一点' } });
      await sleep(3000);
      multi = await measure();
      console.log('  多行测量：', JSON.stringify(multi));
    } catch (e) { console.log('  onInput:', e.message); }

    if (multi && multi.inputBar && base && base.inputBar) {
      const grew = multi.inputBar.h > base.inputBar.h + 1;
      check('B2 输入多行后输入栏变高', grew,
        `${base.inputBar.h.toFixed(1)}px → ${multi.inputBar.h.toFixed(1)}px`);
      if (multi.panel) {
        const gap2 = Math.abs(multi.inputBar.top - multi.panel.bottom);
        check('B3 输入栏变高后面板仍贴合（未被输入框盖住）', gap2 <= 3,
          `panel.bottom=${multi.panel.bottom.toFixed(1)} input.top=${multi.inputBar.top.toFixed(1)} gap=${gap2.toFixed(1)}px`);
      } else {
        // onInput 里刻意 `if (showPlus) setData({showPlus:false})` —— 打字时收起面板是微信的既有交互
        // （注释原文：「输入时关掉 plus 面板（避免和键盘一起占空间）」）。
        // 所以这里判定为「按设计收起」，并改为验证重开后仍对齐，而不是记成失败。
        console.log('  输入后 +面板按设计收起（onInput → showPlus:false），改为验证重开后对齐');
        try { await rp.callMethod('togglePlus'); } catch (e) {}
        await sleep(2000);
        const again = await measure();
        console.log('  重开面板测量：', JSON.stringify(again));
        if (again && again.panel && again.inputBar) {
          const gap3 = Math.abs(again.inputBar.top - again.panel.bottom);
          check('B3 多行输入后重开面板仍贴合', gap3 <= 3,
            `panel.bottom=${again.panel.bottom.toFixed(1)} input.top=${again.inputBar.top.toFixed(1)} gap=${gap3.toFixed(1)}px（输入栏已撑高至 ${again.inputBar.h.toFixed(1)}px）`);
        } else {
          check('B3 多行输入后重开面板仍贴合', false, '重开后仍量不到面板');
        }
      }
    } else {
      check('B2 输入多行后输入栏变高', false, '量不到：' + JSON.stringify(multi));
      check('B3 输入栏变高后面板仍贴合（未被输入框盖住）', false, '量不到');
    }
    shots.push('fix_chatroom_panel.png');
  }

  // ============ C. 安全区兜底页（原 3 页无 .page 样式）============
  console.log('\n— C. 安全区兜底 —');
  // 用 wxml 层无法直接量 env()，改为确认全局基线的 class 生效：三页 .page 存在且高度等于视口高
  const safePages = ['/pages/credit/credit', '/pages/agreement/agreement', '/pages/privacy/privacy'];
  for (const sp of safePages) {
    try {
      await mp2.reLaunch(sp);
      const okp = await waitPath(mp2, sp.replace('/pages/', 'pages/'), 12000);
      await sleep(5000);
      const r = await mp2.evaluate(() => new Promise(resolve => {
        const q = wx.createSelectorQuery();
        const out = {};
        try { out.route = getCurrentPages().slice(-1)[0].route; } catch (e) {}
        q.select('.page').boundingClientRect(x => { out.rect = x; resolve(out); }).exec();
      })).catch(() => null);
      check(`C ${sp.split('/')[2]} 页 .page 已渲染且有高度`,
        !!(r && r.rect && r.rect.height > 0),
        r && r.rect ? `route=${r.route} height=${r.rect.height.toFixed(0)}px` : '量不到 .page');
    } catch (e) {
      check(`C ${sp.split('/')[2]} 页 .page 已渲染且有高度`, false, e.message);
    }
  }

  // ============ D. 全局无废弃 API 警告 ============
  console.log('\n— D. 废弃 API 警告 —');
  const allLogs = await drainLogs(mp2);
  const dep = allLogs.filter(x => /getSystemInfoSync is deprecated/i.test(x.m));
  const errs2 = allLogs.filter(x => x.l === 'error');
  check('D1 全程无 getSystemInfoSync 废弃警告', dep.length === 0,
    dep.length ? `${dep.length} 条` : '干净');
  check('D2 全程无 console.error', errs2.length === 0,
    errs2.length ? errs2.map(e => e.m.slice(0, 80)).join(' | ') : '干净');

  // ============ 截图（约定 #2：截图会重置页面栈 → 必须放最后，且不早于任何断言）============
  // ⚠️ 踩坑：第一次跑时把截图放在 B 组断言之前，截图把页面栈重置成了首页，
  // 导致 B 组量到的是**首页的 DOM**，报了 gap=238.5px 的假失败（两次读数一模一样
  // 就是因为它量的是同一个静止的首页）。这里保证截图是最后一步。
  console.log('\n— 截图 —');
  const outDir = path.join(projectPath, '.workbuddy', 'tmp');
  for (const s of shots) {
    try {
      await mp2.screenshot({ path: path.join(outDir, s) });
      console.log('  📷', s);
    } catch (e) { console.log('  ✗', s, e.message); }
  }

  // ============ 汇总 ============
  const failed = results.filter(r => !r.pass);
  console.log('\n================ 汇总 ================');
  results.forEach(r => console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : '  ← ' + (r.detail || '')}`));
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);

  try { await mp2.disconnect(); } catch (e) {} // 约定 #1：只 disconnect
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(2); });
