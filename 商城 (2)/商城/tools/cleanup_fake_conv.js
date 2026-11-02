// tools/cleanup_fake_conv.js
// 清理真机验证时由 synthetic-peer 聊天测试留下的测试会话（participants 含 fakepeer_0000...）。
// 该会话由云函数服务端写入，_openid 非当前用户，客户端能否删除取决于 DB 安全规则；
// 若权限不足会明确报出，便于改走云控制台手动删除。
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const FAKE = 'fakepeer_' + '0'.repeat(24);
  const res = await mp.evaluate(async (fake) => {
    const out = { convId: null, convDel: null, msgDel: null, err: null };
    try {
      // 列出我的会话，定位含 fake peer 的那条
      const r = await wx.cloud.callFunction({ name: 'chat', data: { action: 'convs' } });
      const list = (r.result && r.result.data && r.result.data.list) || [];
      const target = list.find(c => Array.isArray(c.participants) && c.participants.indexOf(fake) !== -1);
      if (!target) { out.err = '未找到测试会话（可能已不存在）'; return out; }
      out.convId = target._id;
      const db = wx.cloud.database();
      const convRes = await db.collection('conversations').doc(target._id).remove();
      out.convDel = convRes;
      // 删该会话下的消息
      const msgs = await db.collection('messages').where({ convId: target._id }).get();
      for (const m of (msgs.data || [])) {
        await db.collection('messages').doc(m._id).remove().catch(() => {});
      }
      out.msgDel = (msgs.data || []).length;
    } catch (e) { out.err = (e && e.message) || String(e); }
    return out;
  }, FAKE);
  console.log('清理结果：', JSON.stringify(res, null, 2));
  await mp.disconnect().catch(() => {});
  process.exit(0);
})().catch(e => { console.error('脚本异常', e.message); process.exit(1); });
