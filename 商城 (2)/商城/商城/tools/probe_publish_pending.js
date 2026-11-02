// tools/probe_publish_pending.js —— 验证「发布→待审核」入口，并干净还原。
// 注意：云函数冷启动可能超过 automator 协议超时，故对只读调用先预热一次再正式取。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...a) {
  const p = mp.evaluate(fn, ...a).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(res => {
    wx.cloud.callFunction({ name, data, success: r => resolve(r && r.result ? r.result : { __raw: r }), fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
const bad = r => !r || r.__timeout || r.__evalErr || r.__fail || r.code;
// 只读预热：冷启动超时会唤醒容器，拉大间隔多试几次，待容器真正热起来
async function warmRead(mp, name, data) {
  let r = await callCF(mp, name, data);
  for (let i = 0; i < 4 && bad(r); i++) { await wait(2500); r = await callCF(mp, name, data); }
  return r;
}

(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(3000);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
    await evalSafe(mp, () => { try { globalThis.__p = (wx.getSystemInfoSync && wx.getSystemInfoSync().model) || 'ok'; } catch (e) {} return 'ok'; });
    await wait(1500);

    // 预热 user / goods 容器（只读）
    const me = await warmRead(mp, 'user', { action: 'me' });
    out.me = me && me.data ? { school: me.data.school, credit: me.data.credit } : me;
    await warmRead(mp, 'goods', { action: 'list', page: 1, pageSize: 3, type: 'sell' });

    // 发布求购（免图片），验证进入待审核
    const pub = await callCF(mp, 'goods', { action: 'publish', isWant: true, title: '【自动化测试】求购验证', desc: '自动化测试', category: 'book', price: 0 });
    out.publish = pub;
    const newId = pub && pub.data && pub.data._id;
    if (newId) {
      const pend = await callCF(mp, 'admin', { action: 'listGoods', status: 'pending', pageSize: 20 });
      out.inPending = pend && pend.data ? (pend.data.list || []).some(g => g._id === newId) : false;
      await callCF(mp, 'admin', { action: 'reviewGoods', id: newId, pass: true });
      await wait(400);
      const on = await callCF(mp, 'admin', { action: 'listGoods', status: 'onSale', pageSize: 50 });
      out.onSale = on && on.data ? (on.data.list || []).some(g => g._id === newId) : false;
      const off = await callCF(mp, 'admin', { action: 'adminOff', id: newId, reason: '探针还原' });
      out.off = off && off.code === 0;
    } else {
      out.note = 'publish 未返回 _id（可能冷启动超时或 school 缺失）；见 out.publish';
    }
  } catch (e) { out.fatal = String(e && e.stack || e); }
  finally { if (mp) try { await mp.close(); } catch (e) {} }
  console.log(JSON.stringify(out, null, 2));
})();
