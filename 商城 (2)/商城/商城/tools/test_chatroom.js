// tools/test_chatroom.js —— 聊天页模块测试（需真实会话参数，故单独测）
// 流程：建临时会话 → 发消息 → 进聊天页 → 断言渲染 → 截图 → 清理（消息 + 会话）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp, convId = null, mid = null;
  const marker = '【页面测试】' + Date.now();
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    const me = await rawCF(mp, 'user', { action: 'me' });
    const meOpenid = (me.data && me.data._openid) || '';
    const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 5 });
    const gid = (((gl.data && gl.data.list) || [])[0] || {})._id;
    const ul = await rawCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 50 });
    const peer = (((ul.data && ul.data.list) || []).find(u => u._openid !== meOpenid) || {})._openid;

    const ec = await rawCF(mp, 'chat', { action: 'ensureConv', peerOpenid: peer, goodsId: gid });
    convId = ec.data && (ec.data.convId || ec.data._id);
    chk('准备会话', !!convId, convId ? String(convId).slice(-8) : JSON.stringify(ec).slice(0, 60));

    const sd = await rawCF(mp, 'chat', { action: 'send', convId, type: 'text', content: marker });
    mid = sd.data && sd.data._id;
    chk('准备消息', !!mid, mid ? String(mid).slice(-8) : JSON.stringify(sd).slice(0, 60));

    // 进聊天页
    await mp.navigateTo(`/pages/chatroom/chatroom?convId=${convId}&peer=${peer}&goodsId=${gid}`);
    await wait(9000);
    const st = await evalSafe(mp, (marker) => {
      const p = getCurrentPages().slice(-1)[0];
      const d = (p && p.data) || {};
      const l = d.messages || [];
      return {
        route: p && p.route,
        convId: !!d.convId, peer: !!d.peer, goodsId: !!d.goodsId,
        msgCount: l.length,
        lastText: (l[l.length - 1] || {}).content || '',
        gotMarker: l.some(m => m.content === marker),
        hasGoods: !!(d.goods && (d.goods.title || d.goods._id)),
        peerName: (d.peerInfo && (d.peerInfo.nickName || d.peerName)) || '',
        sending: !!d.sending
      };
    }, marker);
    out.state = st;
    chk('聊天页路由正确', st && st.route === 'pages/chatroom/chatroom', `route=${st && st.route}`);
    chk('会话/对端/商品上下文已就绪', !!(st && st.convId && st.peer && st.goodsId),
      `convId=${st && st.convId} peer=${st && st.peer} goodsId=${st && st.goodsId}`);
    chk('消息列表渲染出刚发的消息', !!(st && st.msgCount > 0 && st.gotMarker),
      `消息数=${st && st.msgCount} 命中标记=${st && st.gotMarker} 末尾="${String(st && st.lastText).slice(0, 20)}"`);
    chk('商品卡片上下文已加载', !!(st && st.hasGoods), st && st.hasGoods ? '已加载' : '未加载');
    chk('对端昵称已加载', !!(st && st.peerName), st && st.peerName ? st.peerName : '(空)');

    try { await mp.screenshot({ path: path.join(__dirname, '_cp_chatroom.png') }); out.shot = true; }
    catch (e) { out.shot = String(e && e.message || e); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp && convId) {
      try { if (mid) await rawCF(mp, 'chat', { action: 'deleteMessage', msgId: mid }); } catch (e) {}
      try {
        const d = await rawCF(mp, 'chat', { action: 'deleteConversation', convId });
        const goneNow = async () => {
          const c = await rawCF(mp, 'chat', { action: 'convs' });
          return !(((c.data && c.data.list) || []).some(x => x._id === convId));
        };
        let gone = await goneNow();
        let note = JSON.stringify(d).slice(0, 90);
        if (!gone) { // 偶发 -404006 未生效 → 重试一次
          await wait(1500);
          await rawCF(mp, 'chat', { action: 'deleteConversation', convId });
          gone = await goneNow();
          note += ' (重试)';
        }
        // 注意：-404006「empty poll result」是云调用偶发中断，函数可能已成功执行，
        // 因此**以状态为准**（会话是否真的从列表消失），而不是看响应码。
        out.cleaned = gone;
        console.log((out.cleaned ? '✅' : '❌') + ' 清理会话（以状态为准）— 返回=' + note + ' 列表已消失=' + gone);
        out.checks.push({ n: '清理临时会话', p: !!out.cleaned, d: gone ? '列表已消失' : '仍存在' });
      } catch (e) { out.cleanErr = String(e && e.message || e); }
    }
    if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
