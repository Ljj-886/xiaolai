// tools/ide_attach.js
// 接入微信开发者工具 + 一次性健康检查：
//   1) 连接确认（appid / 当前页面）
//   2) 云函数探测（确认云端可用 + 耗时）
//   3) 核心页面巡检（导航 + 抓 console.error / loadError）
//
// 接入前置（必须，否则 connect 必失败）：
//   & "D:\weixinkaifa\微信web开发者工具\cli.bat" auto --project "D:\商城" --auto-port 9420
// 注意：wsEndpoint 用 ws://localhost:9420（127.0.0.1 连不上）；连接一次性，close 后需重新激活。

const path = require('path');
const Automator = require('miniprogram-automator');
const projectPath = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CORE_PAGES = [
  { path: '/pages/index/index', label: '首页' },
  { path: '/pages/category/category', label: '分类' },
  { path: '/pages/publish/publish', label: '发布' },
  { path: '/pages/chat/chat', label: '消息' },
  { path: '/pages/mine/mine', label: '我的' },
  { path: '/pages/search/search', label: '搜索' },
  { path: '/pages/detail/detail?id=e04f59456a9f771102dc84722888f359', label: '商品详情' }
];

const CF_CASES = [
  { name: 'goods', label: 'goods.list', data: { action: 'list', page: 1, pageSize: 5, type: 'sell' } },
  { name: 'user', label: 'user.me', data: { action: 'me' } }
];

(async () => {
  const mp = await Automator.connect({
    wsEndpoint: 'ws://localhost:9420', projectPath, cwd: projectPath, timeout: 30000
  });
  console.log('════════ 已接入微信开发者工具 ════════\n');

  // 注入 console.error 收集器
  await mp.evaluate(() => {
    globalThis.__errs = [];
    if (!globalThis.__origErr) {
      globalThis.__origErr = console.error;
      console.error = function (...a) {
        try { globalThis.__errs.push(a.map(x => (x && (x.msg || x.message || x.errMsg)) || String(x)).join(' ').slice(0, 150)); } catch (e) {}
        return globalThis.__origErr.apply(console, a);
      };
    }
  });

  // 1) 项目信息
  const info = await mp.evaluate(() => {
    try {
      const s = getCurrentPages();
      return {
        appid: (__wxConfig && __wxConfig.appid) || '',
        route: s.length ? (s[s.length - 1].route || '') : '(无页面)',
        depth: s.length
      };
    } catch (e) { return { err: String(e) }; }
  });
  console.log(`项目 appid : ${info.appid}`);
  console.log(`当前页面   : ${info.route}（栈深 ${info.depth}）\n`);

  // 2) 云函数探测
  console.log('── 云函数探测 ──');
  for (const c of CF_CASES) {
    const r = await mp.evaluate(cc => new Promise(resolve => {
      const t0 = Date.now();
      const timer = setTimeout(() => resolve({ dt: Date.now() - t0, err: 'TIMEOUT_15S' }), 15000);
      wx.cloud.callFunction({ name: cc.name, data: cc.data })
        .then(res => {
          clearTimeout(timer);
          const rs = res && res.result;
          resolve({ dt: Date.now() - t0, code: rs && rs.code, msg: rs && rs.msg ? String(rs.msg).slice(0, 80) : '' });
        })
        .catch(e => {
          clearTimeout(timer);
          resolve({ dt: Date.now() - t0, errCode: e && e.errCode, errMsg: String((e && (e.errMsg || e.message)) || '').slice(0, 130) });
        });
    }), c);
    const ok = r.code === 0;
    console.log(`${ok ? '✅' : '❌'} ${c.label}  ${r.dt}ms  code=${r.code != null ? r.code : '-'} ${r.msg || r.errMsg || ''}`);
    await sleep(600);
  }

  // 3) 核心页面巡检
  console.log('\n── 核心页面巡检 ──');
  const bad = [];
  for (const p of CORE_PAGES) {
    await mp.evaluate(() => { globalThis.__errs = []; });
    const navOk = await mp.evaluate(url => new Promise(r => {
      wx.reLaunch({ url, success: () => r(true), fail: () => r(false) });
    }), p.path);
    if (!navOk) { bad.push(`${p.label}(导航失败)`); console.log(`❌ ${p.label} 导航失败`); continue; }
    await sleep(2000);

    const r = await mp.evaluate(fields => {
      const errs = (globalThis.__errs || []).slice(0, 3);
      let pageErr = '', route = '';
      try {
        const s = getCurrentPages();
        const cur = s[s.length - 1];
        if (cur) {
          route = cur.route || '';
          if (cur.data) for (const f of fields) if (cur.data[f]) { pageErr = String(cur.data[f]).slice(0, 120); break; }
        }
      } catch (e) {}
      return { errs, pageErr, route };
    }, ['loadError', 'errMsg', 'error', 'errorMsg', 'loadFail', 'actionError']);

    const ok = !r.pageErr && r.errs.length === 0;
    console.log(`${ok ? '✅' : '❌'} ${p.label} (${r.route})`);
    if (r.pageErr) console.log(`     pageErr: ${r.pageErr}`);
    r.errs.forEach(e => console.log(`     console: ${e}`));
    if (!ok) bad.push(p.label);
  }

  console.log('\n══════════════════════════════════════');
  console.log(`核心页面 ${CORE_PAGES.length} 个 | 异常 ${bad.length} 个${bad.length ? '：' + bad.join('、') : '（全部正常）'}`);
  console.log('\n接入完成，可继续下发任务。');

  await mp.close();
})().catch(e => { console.error('FATAL', e && (e.message || e)); process.exit(1); });
