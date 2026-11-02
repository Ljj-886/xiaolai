// tools/live_delete_conv.js
// 真机验证「删除会话」功能（pages/chat 长按删除 → chat.deleteConversation）：
//   1. 用合成 peer 在真实运行时创建一个可控测试会话（send 建会话+写消息）
//   2. convs 确认该会话出现
//   3. 调 deleteConversation 删除
//   4. convs 确认该会话消失；messages(该 convId) 返回 404（会话级联删除后无法访问）
//   5. 顺手清掉上次遗留的 fakepeer 脏会话（走云函数删除，绕开客户端 DB 权限限制）
// 用法：node tools/live_delete_conv.js

const automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, skip = 0;
const ok = (b, msg) => { console.log(`${b ? '✅' : '❌'} ${msg}`); if (b) pass++; else fail++; };
const skipped = (msg) => { console.log(`⚠️  ${msg}`); skip++; };

async function callFn(mp, name, data) {
  const payload = { name, data };
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try {
      return await mp.evaluate(async (p) => {
        const r = await wx.cloud.callFunction({ name: p.name, data: p.data });
        return r.result;
      }, payload);
    } catch (e) {
      const m = (e && e.message) || '';
      lastErr = m;
      if (m.indexOf('429') !== -1 || m.toLowerCase().indexOf('too many') !== -1 || m.indexOf('TOO_FREQUENT') !== -1) {
        await sleep(1500 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw new Error('callFn 重试耗尽: ' + lastErr);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  } catch (e) {
    console.error('❌ 连不上开发者工具，先跑：npm run devtools:auto');
    process.exit(1);
  }
  console.log('✅ 已连接真实运行时\n');

  const myOpenid = await mp.evaluate(() => {
    const a = getApp();
    return (a && a.globalData && a.globalData.openid) || '';
  }).catch(() => '');
  console.log(`   当前 openid=${myOpenid ? myOpenid.slice(0, 8) + '…' : '(空)'}`);

  const listRes = await callFn(mp, 'goods', { action: 'list', page: 1, pageSize: 20, type: 'sell' });
  await sleep(700);
  const goods = (listRes && listRes.data && listRes.data.list) || [];
  const G = goods[0];
  if (!G) { ok(false, '商品列表为空，无法构造会话用例'); return finish(); }
  console.log(`   取商品：${G._id}\n`);

  // —— 1. 创建可控测试会话（合成 peer）——
  const peer = 'autotest_peer_' + Date.now();
  const sendRes = await callFn(mp, 'chat', { action: 'send', convId: '', peerOpenid: peer, goodsId: G._id, type: 'text', content: '删除会话验证-临时消息' });
  await sleep(700);
  ok(sendRes && sendRes.code === 0, `创建测试会话 send：code=${sendRes && sendRes.code}${sendRes && sendRes.code !== 0 ? ' msg=' + sendRes.msg : ''}`);
  const testConvId = sendRes && sendRes.data && sendRes.data.convId;
  ok(!!testConvId, `拿到测试会话 convId=${testConvId ? testConvId.slice(0, 16) + '…' : '(空)'}`);
  if (!testConvId) return finish();

  // —— 2. convs 确认会话出现 ——
  let convsRes = await callFn(mp, 'chat', { action: 'convs' });
  await sleep(500);
  const before = (convsRes && convsRes.data && convsRes.data.list) || [];
  ok(before.some(c => c._id === testConvId), '删除前 convs 含测试会话');

  // —— 3. 删除该会话 ——
  const delRes = await callFn(mp, 'chat', { action: 'deleteConversation', convId: testConvId });
  await sleep(700);
  ok(delRes && delRes.code === 0, `deleteConversation：code=${delRes && delRes.code}${delRes && delRes.code !== 0 ? ' msg=' + delRes.msg : ''}`);

  // —— 4. convs 确认消失 + messages 返回 404（级联删除后不可访问）——
  convsRes = await callFn(mp, 'chat', { action: 'convs' });
  await sleep(500);
  const after = (convsRes && convsRes.data && convsRes.data.list) || [];
  ok(!after.some(c => c._id === testConvId), '删除后 convs 已不含测试会话');
  const msgRes = await callFn(mp, 'chat', { action: 'messages', convId: testConvId, page: 1, pageSize: 10 });
  await sleep(500);
  ok(msgRes && msgRes.code === 404, `删除后 messages 不可访问（code=${msgRes && msgRes.code}，预期 404=会话已级联删除）`);

  // —— 5. 清理上次遗留的 fakepeer 脏会话（若有）——
  const fakeConvs = after.filter(c => (c._id || '').indexOf('fakepeer') !== -1);
  if (fakeConvs.length) {
    for (const fc of fakeConvs) {
      const fr = await callFn(mp, 'chat', { action: 'deleteConversation', convId: fc._id });
      await sleep(700);
      ok(fr && fr.code === 0, `清理遗留脏会话 ${fc._id.slice(0, 16)}…：${fr && fr.code === 0 ? '成功' : 'code=' + (fr && fr.code) + ' msg=' + (fr && fr.msg)}`);
    }
  } else {
    skipped('无遗留 fakepeer 脏会话（已清或从未创建）');
  }

  finish();

  function finish() {
    console.log(`\n${'='.repeat(46)}`);
    console.log(`结果：通过 ${pass} ｜ 失败 ${fail} ｜ 跳过 ${skip}`);
    console.log(fail === 0 ? '🎉 删除会话功能真机验证通过，脏会话已清理' : '⚠️  存在失败项，需排查');
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error('❌ 脚本异常', e.message); process.exit(1); });
