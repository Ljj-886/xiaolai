// tools/verify_tabbar_badge.js —— 单独验证自定义 tabBar 的未读角标（避开多次 switchTab 导致的 automator 退化）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
}

(async () => {
  const checks = [];
  const chk = (n, ok, d) => { checks.push({ n, ok }); console.log((ok ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);

    await mp.switchTab('/pages/chat/chat');
    await wait(5000);

    const read = () => evalSafe(mp, () => {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      const bar = cur && typeof cur.getTabBar === 'function' ? cur.getTabBar() : null;
      return bar && bar.data ? { selected: bar.data.selected, unread: bar.data.unread } : { err: 'no-bar' };
    });

    const before = await read();
    chk('初始可读取 tabBar 数据', !before.err, JSON.stringify(before));

    for (const n of [7, 0, 123, 0]) {
      await evalSafe(mp, (v) => { getApp().setUnreadBadge(v); return true; }, n);
      await wait(1500);
      const st = await read();
      chk(`setUnreadBadge(${n}) → 组件 unread=${n}`, st.unread === n, JSON.stringify(st));
      if (n === 123) {
        try { await mp.screenshot({ path: path.join(__dirname, '_tb_badge.png') }); console.log('    截图: tools/_tb_badge.png（99+ 角标）'); } catch (e) {}
      }
    }
  } catch (e) {
    chk('执行异常', false, String((e && e.message) || e).slice(0, 120));
  }
  const failed = checks.filter(c => !c.ok).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${checks.length - failed} / ${checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
})();
