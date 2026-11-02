// tools/_shot_review_report.js —— 造一条举报 + 截图验证举报卡新样式（含商品跳转入口）
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420', projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
  await wait(2500);
  await mp.evaluate(() => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });
  const call = async (n, d) => mp.evaluate((nn, dd) => wx.cloud.callFunction({ name: nn, data: dd })
    .then(r => r.result).catch(e => ({ __err: String((e && e.errMsg) || e) })), n, d);

  // 取一件在售商品作为举报目标
  const ls = await call('goods', { action: 'list', type: 'sell', status: 'onSale', pageSize: 3 });
  const g = ((ls.data && ls.data.list) || [])[0];
  if (!g) { console.log('没有在售商品可举报'); process.exit(0); }
  console.log('目标商品:', g.title, g._id, '| seller:', g._openid);

  // 直接写一条举报记录（模拟用户举报），便于截图验证后台渲染。
  // 注意：云开发不允许客户端显式指定 _openid（-501007），由服务端自动注入当前用户。
  const rep = await mp.evaluate((gid, gopenid) => {
    const db = wx.cloud.database();
    return db.collection('reports').add({
      data: {
        targetType: 'goods', targetId: gid,
        reason: '疑似假冒品牌', desc: '图片看起来是盗图，与描述不符，建议核实',
        images: [],
        status: 'pending', createdAt: Date.now(),
        reporterNick: '测试举报人', targetOpenid: gopenid
      }
    }).then(r => ({ ok: true, id: r._id })).catch(e => ({ ok: false, err: e.message }));
  }, g._id, g._openid);
  console.log('举报记录:', JSON.stringify(rep));

  // 进后台举报 tab 截图
  await mp.reLaunch('/pages/admin-reviews/admin-reviews?tab=report');
  await wait(4000);
  try { await mp.screenshot({ path: path.join(__dirname, '_review_report_new.png') }); console.log('shot ok'); } catch (e) { console.log('shot fail', e.message); }

  const info = await mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    const d = (p && p.data) || {};
    return { active: d.active, len: (d.list || []).length, first: (d.list || [])[0] ? {
      title: d.list[0].goodsTitle, status: d.list[0].goodsStatusText,
      canJump: d.list[0].canJumpGoods, reason: d.list[0].reason
    } : null };
  }).catch(e => ({ err: e.message }));
  console.log('page:', JSON.stringify(info));

  // 清理
  if (rep && rep.ok && rep.id) {
    const del = await mp.evaluate((id) => {
      const db = wx.cloud.database();
      return db.collection('reports').doc(id).remove().then(() => ({ ok: true })).catch(e => ({ ok: false, err: e.message }));
    }, rep.id);
    console.log('cleanup:', JSON.stringify(del));
  }
  process.exit(0);
})();
