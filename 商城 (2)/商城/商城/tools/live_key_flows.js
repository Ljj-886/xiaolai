// 定向测试最近修改的模块：详情(想要/收藏) / 消息(长按删除) / 发布(类型切换)
// 每个操作单独 evaluate + 充分等待，避免连续高频调用把 automator 拖超时（上次踩的坑）
const path = require('path');
const Automator = require('miniprogram-automator');
const projectPath = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const GOODS_ID = 'e04f59456a9f771102dc84722888f359';

(async () => {
  const mp = await Automator.connect({
    wsEndpoint: 'ws://localhost:9420', projectPath, cwd: projectPath, timeout: 30000
  });
  console.log('✅ connected\n');

  const nav = url => mp.evaluate(u => new Promise(r => {
    wx.reLaunch({ url: u, success: () => r(true), fail: e => r(String(e && e.errMsg || e)) });
  }), url);

  // ---------- 1. 商品详情 ----------
  console.log('=== 1. 商品详情 ===');
  console.log('nav:', await nav(`/pages/detail/detail?id=${GOODS_ID}`));
  await sleep(3000);
  const d1 = await mp.evaluate(() => {
    const cur = getCurrentPages()[getCurrentPages().length - 1];
    const d = cur && cur.data || {};
    return {
      route: cur && cur.route,
      hasGoods: !!(d.goods || d.item),
      title: (d.goods && d.goods.title) || (d.item && d.item.title) || '',
      wanted: d.wanted, faved: d.faved,
      loadError: d.loadError || d.errMsg || '',
      actionError: d.actionError || ''
    };
  });
  console.log('详情数据:', JSON.stringify(d1));

  // 想要
  const wantRes = await mp.evaluate(() => new Promise(resolve => {
    const cur = getCurrentPages()[getCurrentPages().length - 1];
    if (!cur || typeof cur.toggleWant !== 'function') return resolve('NO_METHOD');
    const before = cur.data.wanted;
    const r = cur.toggleWant();
    const done = () => setTimeout(() => resolve({ before, after: cur.data.wanted, err: cur.data.actionError || '' }), 3500);
    if (r && r.then) r.then(done, e => resolve('REJECT:' + String(e && e.msg || e)));
    else done();
  }));
  console.log('toggleWant:', JSON.stringify(wantRes));

  // 收藏
  const favRes = await mp.evaluate(() => new Promise(resolve => {
    const cur = getCurrentPages()[getCurrentPages().length - 1];
    if (!cur || typeof cur.toggleFav !== 'function') return resolve('NO_METHOD');
    const before = cur.data.faved;
    const r = cur.toggleFav();
    const done = () => setTimeout(() => resolve({ before, after: cur.data.faved, err: cur.data.actionError || '' }), 3500);
    if (r && r.then) r.then(done, e => resolve('REJECT:' + String(e && e.msg || e)));
    else done();
  }));
  console.log('toggleFav:', JSON.stringify(favRes));

  // ---------- 2. 消息 ----------
  console.log('\n=== 2. 消息（长按删除） ===');
  console.log('nav:', await nav('/pages/chat/chat'));
  await sleep(3000);
  const c1 = await mp.evaluate(() => {
    const cur = getCurrentPages()[getCurrentPages().length - 1];
    const d = cur && cur.data || {};
    return {
      route: cur && cur.route,
      count: (d.list || []).length,
      hasLongPress: typeof (cur && cur.onLongPress) === 'function',
      err: d.loadError || ''
    };
  });
  console.log('消息页:', JSON.stringify(c1));

  if (c1.count > 0) {
    const delRes = await mp.evaluate(() => new Promise(resolve => {
      const cur = getCurrentPages()[getCurrentPages().length - 1];
      const conv = cur.data.list[0];
      // 直接验证弹窗确认逻辑（不自动点确定，避免真删数据）
      const r = cur.onLongPress({ currentTarget: { dataset: { conv } } });
      setTimeout(() => resolve({ called: true, convId: conv && conv._id }), 1200);
    }));
    console.log('onLongPress(长按删除):', JSON.stringify(delRes), '(会弹确认框，未自动确认)');
  } else {
    console.log('onLongPress: 无会话可测（列表为空），方法存在 =', c1.hasLongPress);
  }

  // ---------- 3. 发布 ----------
  console.log('\n=== 3. 发布（类型切换） ===');
  console.log('nav:', await nav('/pages/publish/publish'));
  await sleep(3000);
  const p1 = await mp.evaluate(() => {
    const cur = getCurrentPages()[getCurrentPages().length - 1];
    const d = cur && cur.data || {};
    return { route: cur && cur.route, type: d.type, hasSetType: typeof (cur && cur.setType) === 'function', err: d.loadError || '' };
  });
  console.log('发布页初始:', JSON.stringify(p1));

  const setRes = await mp.evaluate(() => new Promise(resolve => {
    const cur = getCurrentPages()[getCurrentPages().length - 1];
    if (typeof cur.setType !== 'function') return resolve('NO_METHOD');
    cur.setType({ currentTarget: { dataset: { type: 'want' } } });
    setTimeout(() => resolve({ after: cur.data.type }), 800);
    cur.setType({ currentTarget: { dataset: { type: 'sell' } } });
  }));
  console.log('setType 切换:', JSON.stringify(setRes));

  await mp.close();
  console.log('\ndone.');
})().catch(e => { console.error('FATAL', e && (e.message || e)); process.exit(1); });
