// tools/_probe_campus_or.js —— 实测 where.campus = _.or([...]) 是否真的静默失效
// 对照：_.neq 写法 / 顶层 _.or 写法 / 不做学校过滤
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
      const out = {};
      // 先看全量 onSale 商品的 campus 分布
      col.where({ status: 'onSale' }).field({ _id: true, campus: true, title: true })
        .limit(100).get().then(async all => {
          out.allOnSale = all.data.length;
          out.campusDist = {};
          all.data.forEach(g => {
            const k = (g.campus === undefined) ? '__MISSING__' : (g.campus === '' ? '__EMPTY__' : (g.campus === null ? '__NULL__' : String(g.campus)));
            out.campusDist[k] = (out.campusDist[k] || 0) + 1;
          });
          const mySchool = '清华大学'; // 调用者学校（示例）
          // 写法 A：字段级嵌套 _.or（当前代码，疑似静默失效）
          try {
            const a = await col.where({
              status: 'onSale',
              campus: _.or([{ campus: mySchool }, { campus: _.in(['', null]) }, { campus: _.exists(false) }])
            }).count();
            out.A_nestedOr = a.total;
          } catch (e) { out.A_nestedOr = 'ERR:' + (e.errMsg || e.message); }
          // 写法 B：顶层 _.or
          try {
            const b = await col.where(_.and([
              { status: 'onSale' },
              _.or([{ campus: mySchool }, { campus: _.in(['', null]) }, { campus: _.exists(false) }])
            ])).count();
            out.B_topOr = b.total;
          } catch (e) { out.B_topOr = 'ERR:' + (e.errMsg || e.message); }
          // 写法 C：干脆不过滤学校（对照组，应等于 allOnSale）
          try {
            const c = await col.where({ status: 'onSale' }).count();
            out.C_noFilter = c.total;
          } catch (e) { out.C_noFilter = 'ERR:' + (e.errMsg || e.message); }
          // 写法 D：只查本校（正确期望值）
          try {
            const d = await col.where({ status: 'onSale', campus: mySchool }).count();
            out.D_schoolOnly = d.total;
          } catch (e) { out.D_schoolOnly = 'ERR:' + (e.errMsg || e.message); }
          resolve(out);
        }).catch(e => resolve({ err: String(e.errMsg || e.message) }));
    }));
    console.log(JSON.stringify(r, null, 1));
  } catch (e) { console.log('异常: ' + String(e && e.message || e)); }
})();
