// tools/_clean_offreason.js —— 清理历史脏数据：把误写入 offReason 的表单占位文案清空
// 说明：早期通过「数据库导入 / 自动化」写入时，把表单 label 误当成 reason 存进了 offReason。
// 这里只清「明显是占位文案」的条目，保留真实原因（如「自动化测试还原」）。
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
      wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' });
      const db = wx.cloud.database();
      const _ = db.command;
      // 找出所有 offReason 含「请填写」的脏条目
      db.collection('goods').where({ offReason: db.RegExp({ regexp: '请填写', options: 'i' }) })
        .limit(100).get().then(async res => {
          const outs = [];
          for (const g of res.data) {
            try {
              await db.collection('goods').doc(g._id).update({ data: { offReason: '' } });
              outs.push({ id: g._id, before: g.offReason, after: '' });
            } catch (e) {
              outs.push({ id: g._id, err: String(e && e.errMsg || e) });
            }
          }
          resolve({ total: res.data.length, outs });
        }).catch(e => resolve({ err: String(e && e.errMsg || e) }));
    }));
    console.log(JSON.stringify(r, null, 1));
  } catch (e) { console.log('异常: ' + String(e && e.message || e)); }
})();
