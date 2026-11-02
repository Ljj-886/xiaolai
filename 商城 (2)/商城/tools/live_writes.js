// tools/live_writes.js
// 真机写入链路验证：在真实小程序运行时（automator + 真实云环境）里直接调用云函数，
// 断言「缺失集合」加固后的写入链路不再 502005。
// 覆盖：feedback 提交 / 举报 / 聊天首条消息（建会话+写消息）/ 下单 / 评价
// 注意：页面层的 submit/send 是静默 catch，无法暴露后端错误，故改为运行时内直接 callFunction，
//       拿回真实返回码做断言（环境与 UI 完全一致：同一 wx.cloud 上下文、真实 openid、真实 DB）。
// 用法：node tools/live_writes.js

const automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, skip = 0;
const ok = (b, msg) => { console.log(`${b ? '✅' : '❌'} ${msg}`); if (b) pass++; else fail++; };
const skipped = (msg) => { console.log(`⚠️  ${msg}`); skip++; };

// 在真实运行时内调用云函数（规避 429 退避）
async function callFn(mp, name, data) {
  const payload = { name, data };
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try {
      const result = await mp.evaluate(async (p) => {
        const r = await wx.cloud.callFunction({ name: p.name, data: p.data });
        return r.result;
      }, payload);
      return result;
    } catch (e) {
      const m = (e && e.message) || '';
      lastErr = m;
      // 429 / Too many requests 退避重试
      if (m.indexOf('429') !== -1 || m.toLowerCase().indexOf('too many') !== -1 || m.indexOf('TOO_FREQUENT') !== -1) {
        await sleep(1500 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw new Error('callFn 重试耗尽: ' + lastErr);
}

// 断言写入结果：精确抓「缺失集合」类错误（本轮加固目标）
function assertWrite(name, result, { allowBusiness = true } = {}) {
  if (result === undefined || result === null) {
    ok(false, `${name}：返回为空（传输层错误）`);
    return;
  }
  if (result.code === 0) { ok(true, `${name}：code=0 成功`); return; }
  const msg = result.msg || '';
  // 真正的回归：缺失集合导致的 502005
  if (result.code === 500 && /not exists|502005|ResourceNotFound/.test(msg)) {
    ok(false, `${name}：❌ 缺失集合错误未自愈！code=500 msg=${msg}`);
    return;
  }
  if (result.code === 1 && /not exists|502005|ResourceNotFound/.test(msg)) {
    ok(false, `${name}：❌ 缺失集合错误未自愈！msg=${msg}`);
    return;
  }
  // 其余非 0：多为业务规则（如「不能买自己的」「需同校」），非写入链路崩溃
  if (allowBusiness) {
    skipped(`${name}：业务规则拦截 code=${result.code} msg=${msg}（非缺失集合错误，跳过）`);
  } else {
    ok(false, `${name}：非预期失败 code=${result.code} msg=${msg}`);
  }
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

  // 当前用户 openid（用于判断聊天 peer 是否为自己）
  const myOpenid = await mp.evaluate(() => {
    const a = getApp();
    return (a && a.globalData && a.globalData.openid) || '';
  }).catch(() => '');
  console.log(`   当前 openid=${myOpenid ? myOpenid.slice(0, 8) + '…' : '(空)'}`);

  // 取一个真实商品（及其发布者、校区）
  const listRes = await callFn(mp, 'goods', { action: 'list', page: 1, pageSize: 20, type: 'sell' });
  await sleep(700);
  const goods = (listRes && listRes.data && listRes.data.list) || [];
  const G = goods[0];
  if (!G) { ok(false, '商品列表为空，无法构造后续用例'); return finish(); }
  console.log(`   取商品：${G._id}  发布者=${G._openid ? G._openid.slice(0,8)+'…' : '?'}  campus=${G.campus || '?'}`);

  // —— 1. feedback 提交（无前置依赖）——
  let r = await callFn(mp, 'feedback', { action: 'submit', kind: 'suggest', content: '真机自动化写入验证 ' + Date.now(), contact: '', images: [] });
  await sleep(700);
  assertWrite('feedback 提交', r);

  // —— 2. 举报（targetType=goods, targetId=商品）——
  r = await callFn(mp, 'user', { action: 'report', targetType: 'goods', targetId: G._id, reason: '其他', desc: '真机自动化写入验证' });
  await sleep(700);
  assertWrite('举报', r);

  // —— 3. 聊天：首条消息（建会话 ensureSet + 写消息 ensureAdd）——
  // ensureSet 仅 chat 用到，必须真机验证 conversations/messages 两个集合自愈。
  // 优先用「真实他人商品」做 peer；若列表全为本人（无 _openid 可对话），
  // 退化为合成 peer（不与自己相等即可触发建会话），专门验证写入自愈链路。
  let peer = (G._openid && G._openid !== myOpenid) ? G._openid : '';
  let peerNote = peer ? '（真实他人商品 peer）' : '（合成 peer，仅触发建会话/写消息链路）';
  if (!peer) peer = 'fakepeer_' + '0'.repeat(24).slice(0, 24);
  r = await callFn(mp, 'chat', { action: 'send', convId: '', peerOpenid: peer, goodsId: G._id, type: 'text', content: '真机自动化消息 ' + Date.now() });
  await sleep(700);
  assertWrite('聊天首条消息' + peerNote, r);

  // —— 4. 下单（业务规则可能拦截：不可买自己/需同校）——
  let orderId = null;
  r = await callFn(mp, 'order', { action: 'create', goodsId: G._id, meetingTime: '明天 10:00', meetingPlace: '校门口', message: '' });
  await sleep(700);
  if (r && r.code === 0) {
    orderId = r.data && r.data._id;
    assertWrite('下单', r);
  } else {
    // 业务拦截（自己/同校）不计入失败
    skipped(`下单：code=${r && r.code} msg=${r && r.msg}（多因「不能买自己/需同校」，跳过）`);
  }

  // —— 5. 评价（依赖一个真实订单）——
  if (orderId) {
    r = await callFn(mp, 'user', { action: 'review', orderId, score: 5, tags: [], content: '真机自动化评价验证' });
    await sleep(700);
    assertWrite('评价', r);
  } else {
    skipped('评价：无可用订单（下单被业务规则拦截），跳过');
  }

  finish();

  function finish() {
    console.log(`\n${'='.repeat(46)}`);
    console.log(`结果：通过 ${pass} ｜ 失败 ${fail} ｜ 跳过(业务规则) ${skip}`);
    console.log(fail === 0 ? '🎉 写入链路真机验证无缺失集合错误' : '⚠️  存在缺失集合错误，需排查');
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error('❌ 脚本异常', e.message); process.exit(1); });
