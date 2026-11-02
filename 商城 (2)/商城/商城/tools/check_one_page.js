// tools/check_one_page.js —— 单页检查（一页一进程，避开 automator 在同一进程内多次导航后的陈旧状态）
// 用法：node tools/check_one_page.js <路由> [query]
// 例：  node tools/check_one_page.js /pages/mine/mine
//       node tools/check_one_page.js /pages/detail/detail "id=xxx"
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const ROUTE = process.argv[2] || '/pages/index/index';
const QUERY = process.argv[3] || '';
const wait = ms => new Promise(r => setTimeout(r, ms));
const TAB = ['/pages/index/index', '/pages/category/category', '/pages/publish/publish', '/pages/chat/chat', '/pages/mine/mine'];
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 25000))]);
}

(async () => {
  let mp;
  const out = { route: ROUTE };
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await evalSafe(mp, () => {
      const g = (typeof globalThis !== 'undefined') ? globalThis : window;
      if (!g || g.__logsInstalled) return 'ok';
      g.__logs = [];
      const oe = console.error, ow = console.warn;
      const fmt = (a) => { try { return Array.prototype.slice.call(a).map(x => (typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x))).join(' ').slice(0, 200); } catch (e) { return ''; } };
      console.error = function () { try { g.__logs.push({ lvl: 'error', msg: fmt(arguments) }); } catch (e) {} return oe.apply(console, arguments); };
      console.warn = function () { try { g.__logs.push({ lvl: 'warn', msg: fmt(arguments) }); } catch (e) {} return ow.apply(console, arguments); };
      g.__logsInstalled = true;
      return 'installed';
    });

    const full = QUERY ? `${ROUTE}?${QUERY}` : ROUTE;
    if (TAB.indexOf(ROUTE) >= 0) await mp.switchTab(ROUTE);
    else await mp.reLaunch(full);
    await wait(10000);

    const st = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const d = (p && p.data) || {};
      return {
        route: p && p.route,
        avatarErr: d.avatarErr === true,
        goodsCoverErr: d.goodsCoverErr === true,
        peerAvatarErr: d.peerAvatarErr === true,
        imgErrKeys: Object.keys(d.imgErr || {}),
        listLen: Array.isArray(d.list) ? d.list.length : undefined,
        msgCount: Array.isArray(d.messages) ? d.messages.length : undefined,
        hasItem: !!d.item,
        hasUser: !!(d.user && Object.keys(d.user).length)
      };
    });
    out.state = st;
    const logs = await evalSafe(mp, () => {
      const g = (typeof globalThis !== 'undefined') ? globalThis : window;
      const a = (g && g.__logs) || []; if (g) g.__logs = []; return a;
    });
    const arr = Array.isArray(logs) ? logs : [];
    const noise = [/getSystemInfoSync/i, /getAppBaseInfo/i, /deprecated/i];
    out.errors = arr.filter(l => l.lvl === 'error' && !noise.some(re => re.test(l.msg))).map(l => String(l.msg).slice(0, 180));
    out.warnCount = arr.filter(l => l.lvl === 'warn' && !noise.some(re => re.test(l.msg))).length;

    console.log(`路由: ${ROUTE}`);
    console.log('状态: ' + JSON.stringify(st));
    console.log('调试器错误: ' + out.errors.length + ' 条' + (out.errors.length ? ' → ' + out.errors[0] : ''));
    console.log('调试器警告: ' + out.warnCount + ' 条');

    try {
      const f = path.join(__dirname, '_one_' + ROUTE.replace(/[\/]/g, '_') + '.png');
      await mp.screenshot({ path: f });
      console.log('截图: ' + f);
    } catch (e) { console.log('截图失败: ' + String(e && e.message || e).slice(0, 80)); }
  } catch (e) {
    console.log('异常: ' + String((e && e.message) || e).slice(0, 160));
  } finally {
    // 不要调用 mp.close()：实测它会断开 IDE 的自动化端口，导致连续跑下一个页面时连不上
    // 但要显式退出进程：automator 保持 ws 连接，不退出则 shell 永远不返回
    process.exit(0);
  }
})();
