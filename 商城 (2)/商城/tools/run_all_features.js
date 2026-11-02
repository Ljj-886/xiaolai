// tools/run_all_features.js —— 全功能跑通
//  A) 全量云函数只读接口（断言 code===0 与数据结构）
//  B) 关键写流程（全部使用临时数据，验证后自清理，零残留）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 45000))]);
}
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
async function callCF(mp, name, data, times = 3) {
  for (let i = 0; i < times; i++) {
    const r = await rawCF(mp, name, data);
    const bad = r && (r.__fail || r.__timeout) && /-404006|timeout/.test(String(r.__fail || 'timeout'));
    if (!bad) return r;
    await wait(1200);
  }
  return await rawCF(mp, name, data);
}

// —— 调试器捕获：每个测试步骤后 dump 该步产生的 console 错误/警告 ——
const consoleIssues = [];
async function installConsoleCapture(mp) {
  return evalSafe(mp, () => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (!g) return 'no-global';
    if (g.__logsInstalled) return 'already';
    g.__logs = [];
    const oe = console.error, ow = console.warn;
    const fmt = (args) => {
      try { return Array.prototype.slice.call(args).map(a => (typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a))).join(' ').slice(0, 220); }
      catch (e) { return '[unprintable]'; }
    };
    console.error = function () { try { g.__logs.push({ lvl: 'error', msg: fmt(arguments) }); } catch (e) {} return oe.apply(console, arguments); };
    console.warn = function () { try { g.__logs.push({ lvl: 'warn', msg: fmt(arguments) }); } catch (e) {} return ow.apply(console, arguments); };
    g.__logsInstalled = true;
    return 'installed';
  });
}
async function drainInto(mp, label) {
  const r = await evalSafe(mp, () => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    const out = (g && g.__logs) || [];
    if (g) g.__logs = [];
    return out;
  });
  const logs = Array.isArray(r) ? r : [];
  const noise = [/getSystemInfoSync/i, /getAppBaseInfo/i, /deprecated/i];
  const errs = logs.filter(l => l.lvl === 'error' && !noise.some(re => re.test(l.msg)));
  const warns = logs.filter(l => l.lvl === 'warn' && !noise.some(re => re.test(l.msg)));
  if (errs.length || warns.length) {
    consoleIssues.push({ label, errs: errs.map(e => String(e.msg).slice(0, 200)), warnCount: warns.length });
    console.log(`     🐞 调试器[${label}]：错误 ${errs.length} ｜ 警告 ${warns.length}` + (errs.length ? ` → ${String(errs[0].msg).slice(0, 120)}` : ''));
  }
  return errs.length;
}

const results = { api: [], flow: [] };
const rec = (bucket, label, ok, note) => {
  results[bucket].push({ label, ok, note });
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(38)} ${note || ''}`);
};

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await installConsoleCapture(mp);

    // 上下文
    const me = await callCF(mp, 'user', { action: 'me' });
    const meOpenid = (me.data && me.data._openid) || '';
    const gl0 = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const glist = (gl0.data && gl0.data.list) || [];
    const gid = (glist[0] || {})._id;
    const ol = await callCF(mp, 'order', { action: 'list', role: 'buyer', page: 1, pageSize: 5 });
    const oid = (((ol.data && ol.data.list) || [])[0] || {})._id;
    const ul = await callCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 50 });
    const others = (((ul.data && ul.data.list) || []).filter(u => u._openid !== meOpenid));
    const peer = (others[0] || {})._openid || '';
    console.log(`上下文：me=${String(meOpenid).slice(-6)} goods=${String(gid || '').slice(-6)} order=${String(oid || '').slice(-6)} peer=${String(peer).slice(-6)}\n`);

    // ============ A) 只读接口 ============
    console.log('=========== A) 云函数只读接口 ===========');
    const api = [
      ['login', {}, 'login 登录',
        r => r.code === 0 && !!(r.data && (r.data.openid || (r.data.userInfo && r.data.userInfo._openid)))],
      ['user', { action: 'me' }, 'user.me 我的资料', r => r.code === 0 && !!(r.data && r.data._openid)],
      ['user', { action: 'getPublic', openid: peer }, 'user.getPublic 他人主页', r => r.code === 0 && !!r.data],
      ['user', { action: 'myGoods' }, 'user.myGoods 我的商品', r => r.code === 0 && Array.isArray(r.data.list)],
      ['user', { action: 'myGoods', status: 'pending' }, 'user.myGoods 审核中', r => r.code === 0 && Array.isArray(r.data.list)],
      ['user', { action: 'myGoods', type: 'sell' }, 'user.myGoods type=sell', r => r.code === 0 && Array.isArray(r.data.list)],
      ['user', { action: 'myGoods', type: 'want' }, 'user.myGoods type=want', r => r.code === 0 && Array.isArray(r.data.list)],
      ['user', { action: 'myFavs' }, 'user.myFavs 我的收藏', r => r.code === 0 && Array.isArray(r.data.list)],
      ['user', { action: 'myOrders', role: 'buyer' }, 'user.myOrders 买家', r => r.code === 0 && Array.isArray(r.data.list)],
      ['user', { action: 'myOrders', role: 'seller' }, 'user.myOrders 卖家', r => r.code === 0 && Array.isArray(r.data.list)],
      ['user', { action: 'myCredit' }, 'user.myCredit 信用分', r => r.code === 0],
      ['user', { action: 'listPendingVerify' }, 'user.listPendingVerify 待审认证', r => r.code === 0],
      ['goods', { action: 'list', page: 1, pageSize: 20 }, 'goods.list 首页列表', r => r.code === 0 && r.data.list.length > 0],
      ['goods', { action: 'list', page: 1, pageSize: 1 }, 'goods.list 分页 hasMore', r => r.code === 0 && typeof r.data.hasMore === 'boolean'],
      ['goods', { action: 'list', keyword: '1' }, 'goods.list 关键词搜索', r => r.code === 0 && Array.isArray(r.data.list)],
      ['goods', { action: 'list', keyword: '(' }, 'goods.list 关键词含特殊字符(转义)', r => r.code === 0 && Array.isArray(r.data.list)],
      ['goods', { action: 'list', category: 'book' }, 'goods.list 分类筛选', r => r.code === 0 && Array.isArray(r.data.list)],
      ['goods', { action: 'list', type: 'want' }, 'goods.list type=want', r => r.code === 0 && Array.isArray(r.data.list)],
      ['goods', { action: 'list', type: 'sell' }, 'goods.list type=sell(兼容旧数据)', r => r.code === 0 && Array.isArray(r.data.list)],
      ['goods', { action: 'list', minPrice: 1, maxPrice: 99999 }, 'goods.list 价格区间', r => r.code === 0 && Array.isArray(r.data.list)],
      ['goods', { action: 'list', sort: 'priceAsc' }, 'goods.list 价格升序', r => {
        if (r.code !== 0) return false;
        const p = r.data.list.map(x => Number(x.price) || 0);
        return p.every((v, i) => i === 0 || p[i - 1] <= v);
      }],
      ['goods', { action: 'list', sort: 'priceDesc' }, 'goods.list 价格降序', r => {
        if (r.code !== 0) return false;
        const p = r.data.list.map(x => Number(x.price) || 0);
        return p.every((v, i) => i === 0 || p[i - 1] >= v);
      }],
      ['goods', { action: 'list', sort: 'hot' }, 'goods.list 热度排序', r => r.code === 0 && Array.isArray(r.data.list)],
      ['goods', { action: 'detail', id: gid }, 'goods.detail 商品详情', r => r.code === 0 && !!(r.data && r.data._id)],
      ['goods', { action: 'detail', id: 'no_such_id_000' }, 'goods.detail 不存在商品→优雅失败', r => r.code !== 0],
      ['school', { action: 'list' }, 'school.list 学校清单', r => r.code === 0 && Array.isArray(r.data.list)],
      ['school', { action: 'pickups' }, 'school.pickups 自提点', r => r.code === 0 && Array.isArray(r.data.list)],
      ['school', { action: 'ping' }, 'school.ping', r => r.code === 0],
      ['chat', { action: 'convs' }, 'chat.convs 会话列表', r => r.code === 0 && Array.isArray(r.data.list)],
      ['order', { action: 'list', role: 'buyer' }, 'order.list 买家订单', r => r.code === 0 && Array.isArray(r.data.list)],
      ['order', { action: 'list', role: 'seller' }, 'order.list 卖家订单', r => r.code === 0 && Array.isArray(r.data.list)],
      ['order', { action: 'detail', orderId: oid }, 'order.detail 订单详情', r => r.code === 0 || r.code === 404],
      ['order', { action: 'checkTimeout' }, 'order.checkTimeout 超时巡检', r => r.code === 0],
      ['admin', { action: 'stats' }, 'admin.stats 统计', r => r.code === 0 && typeof r.data.goods === 'number'],
      ...['', 'pending', 'onSale', 'sold', 'off'].map(st => ['admin', { action: 'listGoods', status: st, page: 1, pageSize: 20 },
        `admin.listGoods status=${st || 'all'}`, r => r.code === 0 && Array.isArray(r.data.list)]),
      ['admin', { action: 'listUsers', page: 1, pageSize: 20 }, 'admin.listUsers 用户管理', r => r.code === 0 && Array.isArray(r.data.list)],
      ['admin', { action: 'pendingReports', status: 'all', page: 1, pageSize: 20 }, 'admin.pendingReports 全部举报', r => r.code === 0 && Array.isArray(r.data.list)],
      ['admin', { action: 'pendingReports', status: 'pending', page: 1, pageSize: 20 }, 'admin.pendingReports 待处理', r => r.code === 0 && Array.isArray(r.data.list)],
      ['admin', { action: 'adminLogs', page: 1, pageSize: 20 }, 'admin.adminLogs 审计日志', r => r.code === 0 && Array.isArray(r.data.list)],
      ['admin', { action: 'checkSensitive', text: '这是一段正常文本' }, 'admin.checkSensitive 敏感词', r => r.code === 0],
      ['admin', { action: 'getUserDetail', openid: peer }, 'admin.getUserDetail 用户详情', r => r.code === 0 && !!r.data.user],
      ['seccheck', { action: 'text', content: '这是一段正常文本' }, 'seccheck.text 文本检测', r => r.code === 0],
      ['feedback', { action: 'list', page: 1, pageSize: 20 }, 'feedback.list 反馈列表(管理员)', r => r.code === 0]
    ];
    for (const [fn, data, label, check] of api) {
      let ok = false, note = '';
      try {
        const r = await callCF(mp, fn, data);
        if (r && (r.__fail || r.__timeout)) { ok = false; note = '调用失败 ' + String(r.__fail || 'timeout').slice(0, 60); }
        else { ok = check(r); note = ok ? '' : `code=${r.code} msg=${String(r.msg || '').slice(0, 60)}`; }
      } catch (e) { ok = false; note = String(e && e.message || e).slice(0, 60); }
      rec('api', label, ok, note);
      await drainInto(mp, label); // 每步之后看一眼调试器
    }

    // ============ B) 写流程（自清理） ============
    console.log('\n=========== B) 关键写流程（自清理） ===========');

    // B1. 收藏 → 取消
    if (gid) {
      const inFavs = async () => {
        const r = await callCF(mp, 'user', { action: 'myFavs', page: 1, pageSize: 50 });
        return (((r.data && r.data.list) || []).some(g => g._id === gid));
      };
      const inBefore = await inFavs();
      const t1 = await callCF(mp, 'user', { action: 'toggleFav', goodsId: gid });
      const inAfterAdd = await inFavs();
      const t2 = await callCF(mp, 'user', { action: 'toggleFav', goodsId: gid });
      const inAfterDel = await inFavs();
      // 断言语义统一为「是否在收藏列表」，避免把「不在」和「在」混比
      const pass = t1.code === 0 && t2.code === 0 && inAfterAdd === !inBefore && inAfterDel === inBefore;
      rec('flow', '收藏 → 取消收藏（状态可逆）', pass,
        `初始=${inBefore} → 收藏后=${inAfterAdd} → 取消后=${inAfterDel}`);
    } else { rec('flow', '收藏 → 取消收藏', false, '无可用商品'); }
    await drainInto(mp, '流程·收藏');

    // B2. 想要 → 取消
    if (gid) {
      const t1 = await callCF(mp, 'user', { action: 'toggleWant', goodsId: gid });
      const d1 = await callCF(mp, 'goods', { action: 'detail', id: gid });
      const wantOn = !!(d1.data && d1.data.wanted);
      const t2 = await callCF(mp, 'user', { action: 'toggleWant', goodsId: gid });
      const d2 = await callCF(mp, 'goods', { action: 'detail', id: gid });
      const wantOff = !(d2.data && d2.data.wanted);
      rec('flow', '想要 → 取消想要（状态可逆）', t1.code === 0 && t2.code === 0 && wantOn && wantOff,
        `想要后 wanted=${wantOn} → 取消后 wanted=${d2.data && d2.data.wanted}`);
    } else { rec('flow', '想要 → 取消想要', false, '无可用商品'); }
    await drainInto(mp, '流程·想要');

    // B3. 发布 → 待审核 → 通过 → 上架 → 删除
    let tempGid = null;
    try {
      const title = '【自动化测试】全功能 ' + Date.now();
      const pub = await callCF(mp, 'goods', { action: 'publish', title, desc: '自动化验证，稍后删除',
        images: [], price: '', category: 'book', condition: 'normal', type: 'want' });
      tempGid = pub && pub.data && pub.data._id;
      if (!tempGid) {
        rec('flow', '发布 → 待审核', false, '发布失败 ' + JSON.stringify(pub));
      } else {
        const d1 = await callCF(mp, 'goods', { action: 'detail', id: tempGid });
        const isPending = d1.data && d1.data.status === 'pending';
        const mg = await callCF(mp, 'user', { action: 'myGoods', status: 'pending', page: 1, pageSize: 50 });
        const inAudit = (((mg.data && mg.data.list) || []).some(g => g._id === tempGid));
        rec('flow', '发布 → 待审核（审核中可见）', isPending && inAudit, `status=${d1.data && d1.data.status} 在审核中列表=${inAudit}`);

        const gl1 = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
        const notOnHome = !(((gl1.data && gl1.data.list) || []).some(g => g._id === tempGid));
        rec('flow', '待审核不在首页（符合审核流）', notOnHome, notOnHome ? '未出现在首页' : '意外出现');

        const rv = await callCF(mp, 'admin', { action: 'reviewGoods', id: tempGid, pass: true });
        const d2 = await callCF(mp, 'goods', { action: 'detail', id: tempGid });
        const gl2 = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
        const onHome = (((gl2.data && gl2.data.list) || []).some(g => g._id === tempGid));
        rec('flow', '审核通过 → 上架可见', rv.code === 0 && d2.data.status === 'onSale' && onHome,
          `status=${d2.data && d2.data.status} 首页可见=${onHome}`);

        const del = await callCF(mp, 'goods', { action: 'remove', id: tempGid });
        const d3 = await callCF(mp, 'goods', { action: 'detail', id: tempGid });
        rec('flow', '删除临时商品（清理）', del.code === 0 && d3.code !== 0, `remove=${del.code === 0} 已不可查=${d3.code !== 0}`);
        tempGid = null;
      }
    } catch (e) { rec('flow', '发布审核链路', false, String(e && e.message || e).slice(0, 80)); }
    await drainInto(mp, '流程·发布审核');

    // B4. 私聊：建会话 → 发消息 → 撤回 → 删会话
    if (peer && gid) {
      let convId = null;
      try {
        const ec = await callCF(mp, 'chat', { action: 'ensureConv', peerOpenid: peer, goodsId: gid });
        convId = ec.data && (ec.data.convId || ec.data._id);
        rec('flow', 'chat.ensureConv 建立会话', ec.code === 0 && !!convId, convId ? String(convId).slice(-8) : JSON.stringify(ec).slice(0, 60));

        if (convId) {
          const marker = '【自动化测试】' + Date.now();
          const sd = await callCF(mp, 'chat', { action: 'send', convId, type: 'text', content: marker });
          const mid = sd.data && sd.data._id;
          rec('flow', 'chat.send 发送消息并返回 _id', sd.code === 0 && !!mid, mid ? String(mid).slice(-8) : JSON.stringify(sd).slice(0, 60));

          const ms = await callCF(mp, 'chat', { action: 'messages', convId, page: 1, pageSize: 30 });
          const got = ((ms.data && ms.data.list) || []).some(m => m.content === marker);
          rec('flow', 'chat.messages 能读到刚发的消息', got, got ? '已读到' : '未读到');

          // 进入聊天页做真实渲染验证（含消息列表渲染 + 截图）
          try {
            await mp.navigateTo(`/pages/chatroom/chatroom?convId=${convId}&peer=${peer}&goodsId=${gid}`);
            await wait(8000);
            const cs = await evalSafe(mp, () => {
              const p = getCurrentPages().slice(-1)[0];
              const d = (p && p.data) || {};
              return {
                route: p && p.route, hasConv: !!d.convId, hasPeer: !!d.peer,
                messages: (d.messages || []).length,
                mine: ((d.messages || [])[0] || {}).mine,
                firstText: ((d.messages || [])[0] || {}).content || ''
              };
            });
            const okRoom = cs.route === 'pages/chatroom/chatroom' && cs.hasConv && cs.messages > 0;
            rec('flow', 'chatroom 聊天页渲染消息', okRoom,
              `route=${cs.route} 消息数=${cs.messages} peer=${cs.hasPeer} 首条="${String(cs.firstText).slice(0, 18)}"`);
            try { await mp.screenshot({ path: path.join(__dirname, '_fl_chatroom.png') }); } catch (e) {}
            // 返回，避免聊天页的轮询干扰后续
            await evalSafe(mp, () => { wx.navigateBack({ delta: 1 }); return true; });
            await wait(1500);
          } catch (e) {
            rec('flow', 'chatroom 聊天页渲染消息', false, String(e && e.message || e).slice(0, 70));
          }

          if (mid) {
            const goneNow = async () => {
              const r = await callCF(mp, 'chat', { action: 'messages', convId, page: 1, pageSize: 30 });
              return !((r.data && r.data.list) || []).some(m => m.content === marker);
            };
            await callCF(mp, 'chat', { action: 'deleteMessage', msgId: mid });
            let gone = await goneNow();
            let dmCode = 'ok';
            if (!gone) { // 偶发未立即生效 → 稍等重试一次（隔离复现中撤回本身是正常的）
              await wait(1500);
              const dm2 = await callCF(mp, 'chat', { action: 'deleteMessage', msgId: mid });
              dmCode = 'retry code=' + (dm2 && dm2.code);
              gone = await goneNow();
            }
            rec('flow', 'chat.deleteMessage 撤回（清理）', gone, gone ? '已撤回' : '仍存在 ' + dmCode);
          }
          const dc = await callCF(mp, 'chat', { action: 'deleteConversation', convId });
          const cv = await callCF(mp, 'chat', { action: 'convs' });
          const convGone = !(((cv.data && cv.data.list) || []).some(c => c._id === convId));
          rec('flow', 'chat.deleteConversation 删会话（清理）', dc.code === 0 && convGone, `删除=${dc.code === 0} 列表已消失=${convGone}`);
        }
      } catch (e) { rec('flow', '私聊链路', false, String(e && e.message || e).slice(0, 80)); }
    } else { rec('flow', '私聊链路', false, '缺少 peer 或 goodsId'); }
    await drainInto(mp, '流程·私聊');
  } catch (e) {
    console.log('❌ 脚本异常：' + String((e && e.stack) || e));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }

  const all = [...results.api, ...results.flow];
  const failed = all.filter(r => !r.ok);
  console.log(`\n${'='.repeat(56)}`);
  console.log(`接口 ${results.api.length} 项 ｜ ✅ ${results.api.filter(r => r.ok).length} ｜ ❌ ${results.api.filter(r => !r.ok).length}`);
  console.log(`流程 ${results.flow.length} 项 ｜ ✅ ${results.flow.filter(r => r.ok).length} ｜ ❌ ${results.flow.filter(r => !r.ok).length}`);
  console.log(`合计 ${all.length} 项 ｜ ✅ ${all.length - failed.length} ｜ ❌ ${failed.length}`);
  const totalErr = consoleIssues.reduce((n, x) => n + x.errs.length, 0);
  const totalWarn = consoleIssues.reduce((n, x) => n + x.warnCount, 0);
  console.log(`调试器：错误 ${totalErr} 条 ｜ 警告 ${totalWarn} 条（涉及 ${consoleIssues.length} 个步骤）`);
  if (consoleIssues.length) {
    console.log('\n调试器明细：');
    consoleIssues.forEach(x => {
      if (x.errs.length) x.errs.forEach(m => console.log(`  🐞 [${x.label}] ${m}`));
      else console.log(`  ⚠️ [${x.label}] ${x.warnCount} 条警告`);
    });
  }
  if (failed.length) {
    console.log('\n失败明细：');
    failed.forEach(f => console.log(`  ❌ [${f.label}] ${f.note}`));
  }
  console.log('\n===== JSON =====');
  console.log(JSON.stringify({ api: results.api, flow: results.flow }, null, 2));
  // 必须显式退出：automator 保持 ws 连接，不退出进程会一直挂着
  process.exit(failed.length ? 1 : 0);
})();
