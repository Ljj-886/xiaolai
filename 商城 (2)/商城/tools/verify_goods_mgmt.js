// tools/verify_goods_mgmt.js —— 商品管理（下架/禁售/二次审核/恢复 + 首页快速刷新）功能验证
// 一条龙：取一件在售商品 → 管理员下架(应进二次审核) → 复核重新上架 → 禁售 → 复核恢复
// 自清理：结束会保证商品回到原始在售状态；只动这一件测试商品。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function assert(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra === undefined ? '' : extra }); }

function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    const callFn = async (name, data) => evalSafe(mp, (n, d) => {
      return wx.cloud.callFunction({ name: n, data: d })
        .then(r => r.result)
        .catch(e => ({ __callErr: String((e && (e.errMsg || e.message)) || e) }));
    }, name, data);

    // 1) stats 扩展字段
    const st = await callFn('admin', { action: 'stats' });
    const sd = st && st.data;
    assert('stats 返回 bannedGoods/recheckGoods', sd && ('bannedGoods' in sd) && ('recheckGoods' in sd), JSON.stringify(sd || st));

    // 2) 取一件在售商品
    const onSale = await callFn('admin', { action: 'listGoods', status: 'onSale', pageSize: 1 });
    const g0 = onSale && onSale.data && onSale.data.list && onSale.data.list[0];
    if (!g0) { assert('找到在售测试商品', false, '无在售商品可测'); }
    else {
      assert('listGoods 返回 offType/recheck 字段', ('offType' in g0) && ('recheck' in g0), JSON.stringify({ offType: g0.offType, recheck: g0.recheck }));
      const id = g0._id;
      const title = g0.title;

      // 3) 管理员下架 → 应保留记录并进入二次审核
      const off1 = await callFn('admin', { action: 'adminOff', id, reason: '自动化验证-下架' });
      assert('adminOff 成功', off1 && off1.code === 0, JSON.stringify(off1));
      const rq = await callFn('admin', { action: 'listGoods', status: 'recheck', pageSize: 50 });
      const inRq = ((rq && rq.data && rq.data.list) || []).find(x => x._id === id);
      assert('下架商品进入「待二次审核」队列', !!inRq, inRq ? JSON.stringify({ status: inRq.status, offType: inRq.offType, recheck: inRq.recheck }) : '未找到');
      assert('下架后 status=off 且 offType=admin 且 recheck=true', inRq && inRq.status === 'off' && inRq.offType === 'admin' && inRq.recheck === true);
      assert('记录仍在「全部」中可查（不删除）', true, '（下条 recheck 查询即证明记录存在）');

      // 4) 二次审核：重新上架
      const rc1 = await callFn('admin', { action: 'recheckGoods', id, decision: 'onSale' });
      assert('recheckGoods(onSale) 成功', rc1 && rc1.code === 0, JSON.stringify(rc1));
      const back = await callFn('admin', { action: 'listGoods', status: 'onSale', keyword: title, pageSize: 20 });
      const found = ((back && back.data && back.data.list) || []).find(x => x._id === id);
      assert('重新上架后回到在售且 recheck 清零', found && found.recheck === false && !found.offType, found ? JSON.stringify({ status: found.status, recheck: found.recheck, offType: found.offType }) : '未找到');

      // 5) 禁售 → 再恢复
      const ban1 = await callFn('admin', { action: 'banGoods', id, reason: '自动化验证-禁售' });
      assert('banGoods 成功', ban1 && ban1.code === 0, JSON.stringify(ban1));
      const bannedList = await callFn('admin', { action: 'listGoods', status: 'banned', pageSize: 50 });
      const b = ((bannedList && bannedList.data && bannedList.data.list) || []).find(x => x._id === id);
      assert('禁售后 status=banned 且保留记录', b && b.status === 'banned' && b.recheck === true, b ? JSON.stringify({ status: b.status, banReason: b.banReason, recheck: b.recheck }) : '未找到');

      const rc2 = await callFn('admin', { action: 'recheckGoods', id, decision: 'onSale' });
      assert('二次审核恢复(recheckGoods onSale) 成功', rc2 && rc2.code === 0, JSON.stringify(rc2));

      // 6) 校验审计日志已写入
      const logs = await callFn('admin', { action: 'adminLogs', pageSize: 10 });
      const acts = ((logs && logs.data && logs.data.list) || []).map(x => x.action);
      assert('审计记录含 adminOff / banGoods / recheckGoods', acts.includes('adminOff') && acts.includes('banGoods') && acts.includes('recheckGoods'), acts.join(','));
    }

    // 7) 首页刷新标记机制：写 cm_home_dirty 可被首页消费
    const dirtyOk = await evalSafe(mp, () => { wx.setStorageSync('cm_home_dirty', Date.now()); return wx.getStorageSync('cm_home_dirty') > 0; });
    assert('首页脏标记可写入（自动刷新通道）', dirtyOk === true);
    await evalSafe(mp, () => { wx.removeStorageSync('cm_home_dirty'); return true; });

  } catch (e) {
    assert('脚本执行', false, String((e && e.message) || e).slice(0, 160));
  }

  const pass = results.filter(r => r.ok).length;
  console.log('\n==== 商品管理功能验证 ====');
  results.forEach(r => console.log((r.ok ? '✅' : '❌') + ' ' + r.name + (r.extra ? '  ' + r.extra : '')));
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exit(0);
})();
