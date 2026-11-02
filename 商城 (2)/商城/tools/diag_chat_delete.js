// tools/diag_chat_delete.js —— 定位「撤回后消息仍存在」：逐步打印每条响应
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const WAIT_ROOM = process.argv[2] === 'room'; // 传 room 则先进入聊天页再撤回（复现失败场景）
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 40000))]);
}
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
const brief = r => JSON.stringify(r).slice(0, 200);

(async () => {
  let mp, convId = null, mid = null;
  const marker = '【诊断】撤回测试 ' + Date.now();
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    console.log('模式：' + (WAIT_ROOM ? '先进入聊天页再撤回' : '直接撤回'));

    const me = await rawCF(mp, 'user', { action: 'me' });
    const meOpenid = (me.data && me.data._openid) || '';
    const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 5 });
    const gid = (((gl.data && gl.data.list) || [])[0] || {})._id;
    const ul = await rawCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 50 });
    const peer = (((ul.data && ul.data.list) || []).find(u => u._openid !== meOpenid) || {})._openid;

    const ec = await rawCF(mp, 'chat', { action: 'ensureConv', peerOpenid: peer, goodsId: gid });
    convId = ec.data && (ec.data.convId || ec.data._id);
    console.log('1) ensureConv →', brief(ec), 'convId=', String(convId).slice(-8));

    const sd = await rawCF(mp, 'chat', { action: 'send', convId, type: 'text', content: marker });
    mid = sd.data && sd.data._id;
    console.log('2) send →', brief(sd), 'msgId=', String(mid).slice(-8));

    const m1 = await rawCF(mp, 'chat', { action: 'messages', convId, page: 1, pageSize: 30 });
    console.log('3) messages →', (m1.data && m1.data.list || []).map(m => ({ id: String(m._id).slice(-8), c: String(m.content).slice(0, 22) })));

    if (WAIT_ROOM) {
      const np = await mp.navigateTo(`/pages/chatroom/chatroom?convId=${convId}&peer=${peer}&goodsId=${gid}`).catch(e => ({ err: String(e && e.message || e) }));
      await wait(7000);
      const st = await evalSafe(mp, () => {
        const p = getCurrentPages().slice(-1)[0];
        return { route: p && p.route, n: ((p && p.data.messages) || []).length };
      });
      console.log('4) 进入聊天页 →', JSON.stringify(st), np && np.err ? 'navigateTo err=' + np.err : '');
      await evalSafe(mp, () => { wx.navigateBack({ delta: 1 }); return true; });
      await wait(2000);
      const st2 = await evalSafe(mp, () => { const p = getCurrentPages().slice(-1)[0]; return { route: p && p.route }; });
      console.log('5) 返回后当前页 →', JSON.stringify(st2));
    }

    const dm = await rawCF(mp, 'chat', { action: 'deleteMessage', msgId: mid });
    console.log('6) deleteMessage →', brief(dm));

    await wait(1500);
    const m2 = await rawCF(mp, 'chat', { action: 'messages', convId, page: 1, pageSize: 30 });
    const still = (m2.data && m2.data.list || []).some(m => m.content === marker);
    console.log('7) messages（撤回后）→', (m2.data && m2.data.list || []).map(m => ({ id: String(m._id).slice(-8), c: String(m.content).slice(0, 22) })));
    console.log('   结论：marker 仍存在 =', still, still ? '❌' : '✅');

    // 再删一次看是否报错
    if (still) {
      const dm2 = await rawCF(mp, 'chat', { action: 'deleteMessage', msgId: mid });
      console.log('8) 再次 deleteMessage →', brief(dm2));
      await wait(1200);
      const m3 = await rawCF(mp, 'chat', { action: 'messages', convId, page: 1, pageSize: 30 });
      const still2 = (m3.data && m3.data.list || []).some(m => m.content === marker);
      console.log('   再次撤回后仍存在 =', still2);
    }
  } catch (e) {
    console.log('❌ 异常：' + String((e && e.stack) || e));
  } finally {
    if (mp && convId) { try { const d = await rawCF(mp, 'chat', { action: 'deleteConversation', convId }); console.log('9) 清理会话 →', brief(d)); } catch (e) {} }
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
