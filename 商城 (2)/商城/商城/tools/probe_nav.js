// 诊断：connect 后不导航，先看小程序当前状态；再逐步尝试 reLaunch/navigateTo
// 打印完整错误对象（automator 抛的常是序列化失败的 [object Object]）
const path = require('path');
const Automator = require('miniprogram-automator');
const projectPath = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function dumpErr(tag, e) {
  console.log(`--- ${tag} ---`);
  if (!e) return console.log('  (no error)');
  console.log('  String(e)     :', String(e).slice(0, 200));
  console.log('  e.message     :', (e.message || '').slice(0, 200));
  if (e.stack) console.log('  e.stack       :', String(e.stack).slice(0, 400));
  const keys = Object.getOwnPropertyNames(e);
  console.log('  own props     :', keys.join(',').slice(0, 300));
  for (const k of keys) {
    if (['message', 'stack'].includes(k)) continue;
    try { console.log(`  e.${k}         :`, JSON.stringify(e[k]).slice(0, 200)); } catch (_) {}
  }
}

(async () => {
  const mp = await Automator.connect({
    wsEndpoint: 'ws://localhost:9420',
    projectPath, cwd: projectPath, timeout: 30000
  });
  console.log('✅ connected');

  // 1. 当前页面
  try {
    const cur = await mp.currentPage();
    console.log('currentPage:', cur ? (cur.path || JSON.stringify(cur).slice(0, 100)) : 'null');
  } catch (e) { dumpErr('currentPage', e); }

  // 2. 页面栈 + 小程序是否活着（evaluate 一个简单表达式）
  try {
    const alive = await mp.evaluate(() => {
      try {
        const s = getCurrentPages();
        return { ok: true, depth: s.length, routes: s.map(p => p.route) };
      } catch (e) { return { ok: false, err: String(e) }; }
    });
    console.log('alive probe:', JSON.stringify(alive));
  } catch (e) { dumpErr('evaluate', e); }

  // 3. 尝试 reLaunch 首页
  try {
    await mp.reLaunch({ url: '/pages/index/index' });
    console.log('reLaunch /pages/index/index → OK');
    await sleep(2500);
    const p = await mp.currentPage();
    console.log('  after reLaunch, page =', p && p.path);
  } catch (e) { dumpErr('reLaunch index', e); }

  // 4. 尝试 navigateTo 搜索页
  try {
    await mp.navigateTo({ url: '/pages/search/search' });
    console.log('navigateTo /pages/search/search → OK');
    await sleep(2000);
    const p = await mp.currentPage();
    console.log('  after navigate, page =', p && p.path);
  } catch (e) { dumpErr('navigateTo search', e); }

  await mp.close();
  console.log('done.');
})().catch(e => { dumpErr('FATAL', e); process.exit(1); });
