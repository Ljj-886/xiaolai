// tools/test_all_pages.js —— 全页面模块测试（26 页）
// 比 live_all_pages 更严：不只判断「没报错」，还逐页 dump data 摘要，
// 用于确认关键数据（列表/统计/表单）真的加载出来了。
//
// 用法：node tools/test_all_pages.js [起始索引] [页数]
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';

const TAB_PAGES = new Set([
  '/pages/index/index', '/pages/category/category', '/pages/publish/publish',
  '/pages/chat/chat', '/pages/mine/mine'
]);
const ERR_FIELDS = ['loadError', 'errMsg', 'error', 'errorMsg', 'loadFail', 'submitError'];
const BATCH = 3;

const START = parseInt(process.argv[2] || '0', 10);
const COUNT = parseInt(process.argv[3] || '999', 10);

const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 25000))]);
}
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}

// —— 控制台捕获：相当于「每步之后查看调试器」 ——
// 包住 console.error / console.warn 收集日志；每个测试步骤后 drain 一次并报告。
async function installConsoleCapture(mp) {
  return evalSafe(mp, () => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (!g) return 'no-global';
    if (g.__logsInstalled) return 'already';
    g.__logs = [];
    const oe = console.error, ow = console.warn;
    const fmt = (args) => {
      try {
        return Array.prototype.slice.call(args).map(a => (typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a))).join(' ').slice(0, 220);
      } catch (e) { return '[unprintable]'; }
    };
    console.error = function () { try { g.__logs.push({ lvl: 'error', msg: fmt(arguments) }); } catch (e) {} return oe.apply(console, arguments); };
    console.warn = function () { try { g.__logs.push({ lvl: 'warn', msg: fmt(arguments) }); } catch (e) {} return ow.apply(console, arguments); };
    g.__logsInstalled = true;
    return 'installed';
  });
}
async function drainLogs(mp) {
  const r = await evalSafe(mp, () => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    const out = (g && g.__logs) || [];
    if (g) g.__logs = [];
    return out;
  });
  return Array.isArray(r) ? r : [];
}
// 与业务无关的噪音（开发者工具自身的弃用警告等）不计入
const NOISE = [/getSystemInfoSync/i, /getAppBaseInfo/i, /deprecated/i, /\[publish\] sensitive-words/i];
const isNoise = (m) => NOISE.some(re => re.test(m));

(async () => {
  // ---- 上下文：真实 id（详情页/订单/聊天页需要）----
  let goodsId = 'e04f59456a9f771102dc84722888f359';
  let orderId = '10b550da6a9c13d701890e973743368b';
  console.log(`上下文：goodsId=${goodsId} | orderId=${orderId} | chatroom 用临时会话\n`);

  // need    = 该字段必须存在且非空（数据一定有的页面）
  // needArr = 该字段必须存在且是数组（允许为空：如「审核中」在无待审商品时本就为空）
  // altRoute= 允许的替代路由（如已登录时打开 login 会自动跳「我的」）
  const PAGES = [
    { path: '/pages/index/index', label: '首页', wait: 9000, need: ['list', 'banners', 'cats'] },
    { path: '/pages/category/category', label: '分类', wait: 9000, need: ['cats'], needArr: ['list'] },
    { path: '/pages/publish/publish', label: '发布', wait: 5000, need: ['cats', 'form'] },
    { path: '/pages/chat/chat', label: '消息', wait: 9000, need: [], needArr: ['list'] },
    { path: '/pages/mine/mine', label: '我的', wait: 9000, need: ['logged'] },
    { path: '/pages/search/search', label: '搜索', wait: 5000, need: ['hotWords'], needArr: ['history', 'list'] },
    { path: '/pages/sold/sold?status=onSale', label: '我的商品', wait: 9000, need: ['tabs'], needArr: ['list'] },
    { path: '/pages/sold/sold?status=pending', label: '我的商品·审核中', wait: 9000, need: ['tabs'], needArr: ['list'] },
    { path: '/pages/favorite/favorite', label: '我的收藏', wait: 9000, need: [], needArr: ['list'] },
    { path: '/pages/credit/credit', label: '信用分', wait: 9000, need: ['credit'] },
    { path: '/pages/pickup/pickup', label: '自提点', wait: 9000, need: [], needArr: ['list'] },
    { path: '/pages/edit-profile/edit-profile', label: '编辑资料', wait: 8000, need: ['form'] },
    { path: '/pages/verify/verify', label: '学生认证', wait: 6000, need: ['educations'] },
    { path: '/pages/login/login', label: '登录', wait: 5000, need: [], altRoute: ['/pages/mine/mine'] },
    { path: '/pages/agreement/agreement', label: '发布协议', wait: 4000, need: ['sections'] },
    { path: '/pages/privacy/privacy', label: '隐私政策', wait: 4000, need: ['sections'] },
    { path: '/pages/feedback/feedback', label: '意见反馈', wait: 6000, need: ['KINDS'] },
    { path: '/pages/order/order', label: '我的订单', wait: 9000, need: ['tabs'], needArr: ['list'] },
    { path: '/pages/admin/admin', label: '管理后台', wait: 10000, need: ['stats'] },
    { path: '/pages/admin-goods/admin-goods', label: '商品管理', wait: 10000, need: ['tabs'], needArr: ['list'] },
    { path: '/pages/admin-users/admin-users', label: '用户管理', wait: 10000, need: ['tabs'], needArr: ['list'] },
    { path: '/pages/admin-reviews/admin-reviews', label: '审核中心', wait: 10000, need: ['tabs'], needArr: ['list'] },
    { path: `/pages/detail/detail?id=${goodsId}`, label: '商品详情', wait: 10000, need: ['item'] },
    { path: `/pages/order-detail/order-detail?id=${orderId}`, label: '订单详情', wait: 10000, need: ['order'] },
    { path: `/pages/review/review?orderId=${orderId}`, label: '评价', wait: 6000, need: ['tags'] },
    { path: `/pages/report/report?targetType=goods&targetId=${goodsId}`, label: '举报', wait: 6000, need: ['REASONS'] }
  ];

  const todo = PAGES.slice(START, START + COUNT);
  const results = [];

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let mp = null;
    try { mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 25000 }); }
    catch (e) {
      batch.forEach(p => { results.push({ label: p.label, ok: false, note: '连不上 IDE' }); console.log(`❌ ${p.label.padEnd(16)} 连不上 IDE`); });
      continue;
    }
    await wait(800);
    await installConsoleCapture(mp);

    for (const p of batch) {
      const base = p.path.split('?')[0];
      let ok = true, note = '', dump = '';
      await drainLogs(mp); // 清掉上一步的残留日志，保证只统计本步产生的问题
      try {
        const job = async () => {
          if (TAB_PAGES.has(base)) await mp.switchTab(base);
          else await mp.reLaunch(p.path);
          await wait(p.wait);
          return await evalSafe(mp, () => {
            const pg = getCurrentPages().slice(-1)[0];
            if (!pg) return { err: '当前无页面' };
            const d = pg.data || {};
            const sum = {};
            Object.keys(d).forEach(k => {
              const v = d[k];
              if (Array.isArray(v)) sum[k] = 'arr' + v.length;
              else if (v && typeof v === 'object') sum[k] = 'obj' + Object.keys(v).length;
              else if (v === '' || v === null || v === undefined || v === false) sum[k] = '';
              else sum[k] = String(v).slice(0, 14);
            });
            return { route: pg.route, sum, errs: {} };
          });
        };
        const r = await Promise.race([job(), new Promise((_, rej) => setTimeout(() => rej(new Error('单页超时')), p.wait + 20000))]);
        if (!r || r.__timeout || r.err) {
          ok = false; note = (r && (r.err || '读取超时')) || '读取失败';
        } else {
          const expect = base.replace(/^\//, '');
          const allowed = [expect].concat((p.altRoute || []).map(s => s.replace(/^\//, '')));
          if (allowed.indexOf(r.route) < 0) { ok = false; note = `路由不符（实际 ${r.route}）`; }
          else {
            // 必须非空的字段
            const missing = (p.need || []).filter(k => {
              const v = r.sum[k];
              return v === undefined || v === '' || v === 'arr0';
            });
            // 必须存在且是数组的字段（允许为空）
            const badArr = (p.needArr || []).filter(k => {
              const v = r.sum[k];
              return v === undefined || v === '' || String(v).indexOf('arr') !== 0;
            });
            if (missing.length) { ok = false; note = `关键数据为空: ${missing.join(',')}`; }
            else if (badArr.length) { ok = false; note = `缺少数组字段: ${badArr.join(',')}`; }
            dump = Object.keys(r.sum).filter(k => r.sum[k] !== '').map(k => `${k}=${r.sum[k]}`).join(' ');
          }
        }
      } catch (e) {
        ok = false; note = String(e && e.message || e).slice(0, 70);
      }
      // —— 查看调试器：统计本步产生的 console 错误/警告 ——
      const logs = await drainLogs(mp);
      const errs = logs.filter(l => l.lvl === 'error' && !isNoise(l.msg));
      const warns = logs.filter(l => l.lvl === 'warn' && !isNoise(l.msg));
      if (errs.length) {
        ok = false;
        note = (note ? note + ' ｜ ' : '') + `调试器报错 ${errs.length} 条：${String(errs[0].msg).slice(0, 130)}`;
      }
      results.push({ label: p.label, ok, note, errs: errs.map(e => String(e.msg).slice(0, 200)), warnCount: warns.length });
      const tag = errs.length ? ` 🐞${errs.length}` : (warns.length ? ` ⚠️${warns.length}` : '');
      console.log(`${ok ? '✅' : '❌'} ${p.label.padEnd(16)} ${note || dump.slice(0, 150)}${tag}`);
    }
    await wait(900); // 批间喘息（不 close，避免端口断开）
  }

  console.log(`\n（检查范围：第 ${START + 1} ~ ${START + todo.length} 页，共 ${todo.length}）`);
  const bad = results.filter(r => !r.ok);
  const withConsoleErr = results.filter(r => (r.errs || []).length);
  const totalErr = results.reduce((n, r) => n + (r.errs || []).length, 0);
  const totalWarn = results.reduce((n, r) => n + (r.warnCount || 0), 0);
  console.log('='.repeat(56));
  console.log(`总计 ${results.length} | ✅ ${results.length - bad.length} | ❌ ${bad.length}`);
  console.log(`调试器：错误 ${totalErr} 条（涉及 ${withConsoleErr.length} 个页面）｜ 警告 ${totalWarn} 条`);
  if (bad.length) {
    console.log('\n失败明细：');
    bad.forEach(r => console.log(`  ❌ ${r.label}: ${r.note}`));
  }
  if (withConsoleErr.length) {
    console.log('\n调试器报错明细：');
    withConsoleErr.forEach(r => r.errs.forEach(m => console.log(`  🐞 [${r.label}] ${m}`)));
  }
  console.log('\n===== JSON =====');
  console.log(JSON.stringify(results, null, 2));
  // 必须显式退出：miniprogram-automator 保持 ws 连接，不退出进程会一直挂着
  process.exit(withConsoleErr.length ? 1 : 0);
})();
