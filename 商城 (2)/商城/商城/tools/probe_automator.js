// tools/probe_automator.js —— 定位 automator 各 API 当前是否可用（rawPath 报错排查）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 15000))]);
}
const step = async (name, fn) => {
  try {
    const r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('超时 15s')), 15000))]);
    console.log(`✅ ${name} → ${typeof r === 'object' ? JSON.stringify(r).slice(0, 110) : String(r).slice(0, 110)}`);
    return true;
  } catch (e) {
    console.log(`❌ ${name} → ${String(e && e.message || e).slice(0, 130)}`);
    return false;
  }
};

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 25000 });
    console.log('已连接');
    await wait(2000);
    await step('mp.evaluate 1+1', () => evalSafe(mp, () => 1 + 1));
    await step('getCurrentPages', () => evalSafe(mp, () => (getCurrentPages() || []).map(p => p.route)));
    await step('mp.currentPage()', async () => { const p = await mp.currentPage(); return { route: p && p.route }; });
    await step('mp.reLaunch(非tab页 favorite)', async () => { await mp.reLaunch('/pages/favorite/favorite'); await wait(3000); return 'ok'; });
    await step('reLaunch 后 evaluate route', () => evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return p && p.route; }));
    await step('mp.switchTab(首页)', async () => { await mp.switchTab('/pages/index/index'); await wait(3000); return 'ok'; });
    await step('switchTab 后 evaluate route', () => evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return p && p.route; }));
    await step('mp.reLaunch(tab页 首页)', async () => { await mp.reLaunch('/pages/index/index'); await wait(3000); return 'ok'; });
    await step('再 evaluate route', () => evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return p && p.route; }));
    await step('mp.currentPage().data()', async () => { const p = await mp.currentPage(); const d = await p.data(); return { keys: Object.keys(d || {}).length }; });
  } catch (e) {
    console.log('❌ 连接/执行异常：' + String((e && e.message) || e).slice(0, 160));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
