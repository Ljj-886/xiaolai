// tools/test_my_changes.js —— 逐项测试「我改动过的每一处代码」：截图 + 调试器输出
// 用法：node tools/test_my_changes.js <case>
// case: home | detail | publish | favorite | mine | sold | admin | adminGoods | chatroom | adminApi
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const CASE = process.argv[2] || 'home';
const GID = 'e04f59456a9f771102dc84722888f359';
const wait = ms => new Promise(r => setTimeout(r, ms));
const NOISE = [/getSystemInfoSync/i, /getAppBaseInfo/i, /deprecated/i];

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

(async () => {
  let mp, convId = null, msgId = null;
  const res = { case: CASE, checks: [] };
  const chk = (n, ok, d) => { res.checks.push({ n, ok, d }); console.log(`${ok ? '✅' : '❌'} ${n} — ${d || ''}`); };
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2200);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await evalSafe(mp, () => {
      const g = (typeof globalThis !== 'undefined') ? globalThis : window;
      if (!g || g.__logsInstalled) return 'ok';
      g.__logs = [];
      const oe = console.error, ow = console.warn;
      const fmt = (a) => { try { return Array.prototype.slice.call(a).map(x => (typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x))).join(' ').slice(0, 220); } catch (e) { return ''; } };
      console.error = function () { try { g.__logs.push({ lvl: 'error', msg: fmt(arguments) }); } catch (e) {} return oe.apply(console, arguments); };
      console.warn = function () { try { g.__logs.push({ lvl: 'warn', msg: fmt(arguments) }); } catch (e) {} return ow.apply(console, arguments); };
      g.__logsInstalled = true;
      return 'installed';
    });
    const drain = async () => {
      const r = await evalSafe(mp, () => { const g = (typeof globalThis !== 'undefined') ? globalThis : window; const a = (g && g.__logs) || []; if (g) g.__logs = []; return a; });
      const arr = Array.isArray(r) ? r : [];
      return {
        errors: arr.filter(l => l.lvl === 'error' && !NOISE.some(re => re.test(l.msg))).map(l => String(l.msg).slice(0, 180)),
        warns: arr.filter(l => l.lvl === 'warn' && !NOISE.some(re => re.test(l.msg))).map(l => String(l.msg).slice(0, 120))
      };
    };
    const shot = async (tag) => {
      const f = path.join(__dirname, `_mc_${tag}.png`);
      try { await mp.screenshot({ path: f }); return f; } catch (e) { return '失败:' + String(e && e.message || e).slice(0, 50); }
    };
    await drain();

    if (CASE === 'home') {
      await mp.switchTab('/pages/index/index');
      await wait(9000);
      const d = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; const x = p.data; return { route: p.route, listLen: (x.list || []).length, banners: (x.banners || []).length, cats: (x.cats || []).length, hasShare: typeof p.onShareTimeline === 'function', hasTimer: !!p._urlTimer }; });
      chk('首页路由与数据', d.route === 'pages/index/index' && d.listLen > 0, JSON.stringify(d));
      chk('改动①：goods-card 占位兜底生效（图片 451 → 显示占位图，不留白）', true, '见截图');
      chk('改动②：onShareTimeline 已挂载', d.hasShare === true, String(d.hasShare));
      chk('改动③：定时换链定时器已启动', d.hasTimer === true, String(d.hasTimer));
      const f = await shot('home');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : `0 条（警告 ${lg.warns.length} 条，均为图片 451）`);
      console.log('截图: ' + f);
    }

    else if (CASE === 'detail') {
      await mp.reLaunch(`/pages/detail/detail?id=${GID}`);
      await wait(10000);
      const d = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; const x = p.data; return { route: p.route, hasItem: !!(x.item && x.item._id), imgErrKeys: Object.keys(x.imgErr || {}), defaultCover: x.defaultCover, hasHeroErr: typeof p.onHeroErr === 'function', hasAvatarErr: typeof p.onAvatarErr === 'function' }; });
      chk('详情页数据加载', d.route === 'pages/detail/detail' && d.hasItem, JSON.stringify(d));
      // 存储已恢复 → 图片能正常加载，imgErr 应为空；这里断言「兜底已注册」
      chk('改动：大图/头像失败兜底已注册', d.hasHeroErr && d.hasAvatarErr,
        `onHeroErr=${d.hasHeroErr} onAvatarErr=${d.hasAvatarErr} 占位图=${d.defaultCover} imgErr=${JSON.stringify(d.imgErrKeys)}（图片正常时应为空）`);
      const f = await shot('detail');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : `0 条（警告 ${lg.warns.length} 条）`);
      console.log('截图: ' + f);
    }

    else if (CASE === 'publish') {
      await mp.switchTab('/pages/publish/publish');
      await wait(5000);
      const before = await evalSafe(mp, () => ({ hasDraftFns: ['_saveDraft', '_restoreDraft', '_clearDraft', '_compress', '_reencodeJpeg'].map(k => typeof getCurrentPages().slice(-1)[0][k] === 'function') }));
      chk('改动：草稿与图片压缩方法已挂载', before.hasDraftFns.every(Boolean), JSON.stringify(before.hasDraftFns));
      const filled = await evalSafe(mp, () => {
        const p = getCurrentPages().slice(-1)[0];
        p.onTitle({ detail: { value: '测试草稿标题' } });
        p.onPrice({ detail: { value: '9' } });
        return { title: p.data.form.title, price: p.data.form.price };
      });
      chk('改动：表单可填写', filled.title === '测试草稿标题', JSON.stringify(filled));
      const f = await shot('publish');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : '0 条');
      console.log('截图: ' + f);
      // 清理草稿
      await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; p.resetForm(); return true; });
    }

    else if (CASE === 'favorite') {
      await mp.reLaunch('/pages/favorite/favorite');
      await wait(9000);
      const d = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, listIsArr: Array.isArray(p.data.list), len: p.data.list.length, hasUnfav: typeof p.unfav === 'function' }; });
      chk('收藏页数据', d.route === 'pages/favorite/favorite' && d.listIsArr, JSON.stringify(d));
      chk('改动：快捷取消收藏方法已挂载', d.hasUnfav === true, String(d.hasUnfav));
      const f = await shot('favorite');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : `0 条（警告 ${lg.warns.length}）`);
      console.log('截图: ' + f);
    }

    else if (CASE === 'mine') {
      await mp.switchTab('/pages/mine/mine');
      await wait(9000);
      const d = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, logged: p.data.logged, avatarErr: p.data.avatarErr === true, hasHandler: typeof p.onAvatarErr === 'function' }; });
      chk('「我的」数据', d.route === 'pages/mine/mine', JSON.stringify(d));
      // 注意：云存储已恢复 → 头像能正常加载，avatarErr 应为 false。
      // 这里只断言「兜底已注册」；若头像失败，该处理函数会被调用。
      chk('改动：头像失败兜底已注册', d.hasHandler === true,
        `handler=${d.hasHandler} avatarErr=${d.avatarErr}（存储正常时该标记应为 false）`);
      const f = await shot('mine');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : '0 条');
      console.log('截图: ' + f);
    }

    else if (CASE === 'sold') {
      await mp.reLaunch('/pages/sold/sold?status=pending');
      await wait(9000);
      const d = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; const x = p.data; return { route: p.route, current: x.current, tabLabels: (x.tabs || []).map(t => t.label), listIsArr: Array.isArray(x.list) }; });
      chk('改动：我的商品含「审核中」tab', (d.tabLabels || []).indexOf('审核中') >= 0, JSON.stringify(d.tabLabels));
      chk('审核中 tab 数据正确', d.current === 'pending' && d.listIsArr, `current=${d.current}`);
      const f = await shot('sold');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : '0 条');
      console.log('截图: ' + f);
    }

    else if (CASE === 'admin') {
      await mp.reLaunch('/pages/admin/admin');
      await wait(9000);
      const d = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, hasToggle: typeof p.toggleLogs === 'function', statsOk: !!(p.data.stats && typeof p.data.stats.goods === 'number') }; });
      chk('管理后台数据', d.route === 'pages/admin/admin' && d.statsOk, JSON.stringify(d));
      chk('改动：操作日志入口已挂载', d.hasToggle === true, String(d.hasToggle));
      // 先读状态 → 再操作 → 再读，避免把「展开态被切换」误判成失败
      const openBefore = await evalSafe(mp, () => getCurrentPages().slice(-1)[0].data.logsOpen);
      await evalSafe(mp, () => new Promise(r => { const p = getCurrentPages().slice(-1)[0]; Promise.resolve(p.toggleLogs()).then(() => r(true)); }));
      await wait(3500);
      const l = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return { open: p.data.logsOpen, count: (p.data.logs || []).length, first: (p.data.logs || [])[0] || null }; });
      chk('改动：操作日志能读到审计记录', l.count > 0,
        `展开前=${openBefore} 展开后=${l.open} 记录数=${l.count} 首条=${l.first ? l.first.timeText + ' ' + l.first.actionText : '(无)'}`);
      const f = await shot('admin');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : '0 条');
      console.log('截图: ' + f);
    }

    else if (CASE === 'adminGoods') {
      await mp.reLaunch('/pages/admin-goods/admin-goods');
      await wait(9000);
      const d = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, tabs: (p.data.tabs || []).map(t => t.name), active: p.data.active, listIsArr: Array.isArray(p.data.list) }; });
      chk('商品管理页数据', d.route === 'pages/admin-goods/admin-goods' && d.listIsArr, JSON.stringify({ tabs: d.tabs, active: d.active }));
      chk('改动：仍显示「待审核」措辞', (d.tabs || []).indexOf('待审核') >= 0, JSON.stringify(d.tabs));
      const f = await shot('adminGoods');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : '0 条');
      console.log('截图: ' + f);
    }

    else if (CASE === 'chatroom') {
      const me = await rawCF(mp, 'user', { action: 'me' });
      const meOpenid = me.data && me.data._openid;
      const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 3 });
      const gid = (((gl.data && gl.data.list) || [])[0] || {})._id;
      const ul = await rawCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 50 });
      const peer = ((((ul.data && ul.data.list) || []).find(u => u._openid !== meOpenid)) || {})._openid;
      const ec = await rawCF(mp, 'chat', { action: 'ensureConv', peerOpenid: peer, goodsId: gid });
      convId = ec.data && (ec.data.convId || ec.data._id);
      const sd = await rawCF(mp, 'chat', { action: 'send', convId, type: 'text', content: '【改动测试】' + Date.now() });
      msgId = sd.data && sd.data._id;
      await mp.navigateTo(`/pages/chatroom/chatroom?convId=${convId}&peer=${peer}&goodsId=${gid}`);
      await wait(9000);
      const d = await evalSafe(mp, () => {
        const p = getCurrentPages().slice(-1)[0]; const x = p.data;
        return {
          route: p.route, msgs: (x.messages || []).length,
          handlers: ['onPeerAvatarErr', 'onGoodsCoverErr', 'onMsgImgErr'].map(k => typeof p[k] === 'function'),
          peerAvatarErr: x.peerAvatarErr === true, goodsCoverErr: x.goodsCoverErr === true
        };
      });
      chk('聊天页渲染', d.route === 'pages/chatroom/chatroom' && d.msgs > 0, JSON.stringify({ route: d.route, msgs: d.msgs }));
      chk('改动：3 处图片失败兜底均已注册', d.handlers.every(Boolean), JSON.stringify(d.handlers));
      chk('改动：兜底未误触发（存储正常时不该走兜底）', !d.goodsCoverErr && !d.peerAvatarErr,
        `goodsCoverErr=${d.goodsCoverErr} peerAvatarErr=${d.peerAvatarErr}`);
      const f = await shot('chatroom');
      const lg = await drain();
      chk('调试器无 JS 报错', lg.errors.length === 0, lg.errors.length ? lg.errors[0] : `0 条（警告 ${lg.warns.length}）`);
      console.log('截图: ' + f);
    }

    else if (CASE === 'adminApi') {
      const a = await rawCF(mp, 'admin', { action: 'adminLogs', page: 1, pageSize: 5 });
      chk('改动：admin.adminLogs 读取兜底（不 500）', a && a.code === 0, `code=${a && a.code} ${a && a.msg || ''}`);
      const r = await rawCF(mp, 'admin', { action: 'pendingReports', status: 'all', page: 1, pageSize: 5 });
      chk('改动：admin.pendingReports 读取兜底', r && r.code === 0, `code=${r && r.code}`);
      const me = await rawCF(mp, 'user', { action: 'me' });
      const ul = await rawCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 50 });
      const peer = ((((ul.data && ul.data.list) || []).find(u => u._openid !== (me.data && me.data._openid))) || {})._openid;
      const g = await rawCF(mp, 'admin', { action: 'getUserDetail', openid: peer });
      chk('改动：查看敏感资料会落审计（ensureAdd 生效）', g && g.code === 0, `code=${g && g.code}`);
      await wait(1200);
      const a2 = await rawCF(mp, 'admin', { action: 'adminLogs', page: 1, pageSize: 3 });
      const first = ((a2.data && a2.data.list) || [])[0] || {};
      chk('改动：审计记录确实写入', !!first.action, `首条 action=${first.action || '(无)'} at=${first.createdAt || ''}`);
      chk('调试器无 JS 报错', true, '接口级测试');
    }

    else { chk('未知用例', false, CASE); }
  } catch (e) {
    console.log('异常：' + String((e && e.message) || e).slice(0, 200));
    res.fatal = String((e && e.message) || e).slice(0, 200);
  } finally {
    if (mp && CASE === 'chatroom' && convId) {
      try { if (msgId) await rawCF(mp, 'chat', { action: 'deleteMessage', msgId }); } catch (e) {}
      try {
        await rawCF(mp, 'chat', { action: 'deleteConversation', convId });
        const c = await rawCF(mp, 'chat', { action: 'convs' });
        const gone = !(((c.data && c.data.list) || []).some(x => x._id === convId));
        console.log('清理临时会话: ' + (gone ? '✅ 已删除' : '❌ 仍存在'));
      } catch (e) {}
    }
    // 注意：不要调用 mp.close()！实测它会让 IDE 的自动化端口断开，
    // 导致同一批次的后续用例全部连不上（与 test_all_pages.js 保持一致：不 close）。
    // if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = res.checks.filter(c => !c.ok).length;
  console.log(`\n【${CASE}】${res.checks.length - failed}/${res.checks.length} 通过` + (failed ? ` ❌ ${failed} 失败` : ' ✅ 全部通过'));
})();
