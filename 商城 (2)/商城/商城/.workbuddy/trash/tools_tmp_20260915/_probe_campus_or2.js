// tools/_probe_campus_or2.js —— 决定性实验：临时插入一条「外校」商品，
// 看 where.campus = _.or([...]) 是否会把外校商品也查出来。
// 若查出来 → 该写法静默失效（多校隔离被破坏）；随后立即删除测试数据。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 25000))]);
}
(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    const r = await evalSafe(mp, () => new Promise(resolve => {
      const db = wx.cloud.database();
      const _ = db.command;
      const col = db.collection('goods');
      const MY = '清华大学';       // 调用者学校
      const OTHER = '北京大学';    // 外校（应被隔离掉）
      const MARK = '__PROBE__' + Date.now();
      const out = { mark: MARK };
      (async () => {
        let probeId = null;
        try {
          // 插入外校测试商品（onSale）
          const add = await col.add({ data: {
            title: MARK, desc: 'probe', price: 1, campus: OTHER,
            status: 'onSale', type: 'sell', category: 'other', createdAt: Date.now()
          }});
          probeId = add._id;
          out.inserted = probeId;

          // A) 当前代码写法：字段级嵌套 _.or
          const a = await col.where({
            status: 'onSale',
            campus: _.or([{ campus: MY }, { campus: _.in(['', null]) }, { campus: _.exists(false) }])
          }).limit(100).get();
          out.A_nestedOr_containsOther = a.data.some(g => g.campus === OTHER);
          out.A_nestedOr_total = a.data.length;

          // B) 顶层 _.or（正确写法对照）
          const b = await col.where(_.and([
            { status: 'onSale' },
            _.or([{ campus: MY }, { campus: _.in(['', null]) }, { campus: _.exists(false) }])
          ])).limit(100).get();
          out.B_topOr_containsOther = b.data.some(g => g.campus === OTHER);
          out.B_topOr_total = b.data.length;

          // C) 直接 eq（最严格对照）
          const c = await col.where({ status: 'onSale', campus: MY }).limit(100).get();
          out.C_eq_containsOther = c.data.some(g => g.campus === OTHER);
          out.C_eq_total = c.data.length;
        } catch (e) {
          out.err = String(e && (e.errMsg || e.message));
        } finally {
          // 无论成败都清理测试数据
          if (probeId) {
            try { await col.doc(probeId).remove(); out.cleaned = true; }
            catch (e) { out.cleanErr = String(e && (e.errMsg || e.message)); }
          }
        }
        resolve(out);
      })();
    }));
    console.log(JSON.stringify(r, null, 1));
  } catch (e) { console.log('异常: ' + String(e && e.message || e)); }
})();
