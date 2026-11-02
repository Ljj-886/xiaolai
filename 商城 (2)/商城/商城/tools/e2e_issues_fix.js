// tools/e2e_issues_fix.js
// 验证「聊天页 + 头像 + 搜索排序」一组修复（automator 0.12 无 evaluate，改用 page.data()/callMethod/$）。
//   A. 全页面遍历，抓取调试器 console error / exception（0 报错为通过）
//   B. 头像 cloud:// → https 转换（读页面 data 中来自云函数的 avatarUrl）
//      - chat 会话列表 peerInfo.avatarUrl（chat.convs）
//      - mine 我的资料 userInfo.avatarUrl（user.me / login）
//      - 进聊天页后 peerInfo.avatarUrl（user.getPublic）
//   B2. 分类页四种排序（category.setSort + 读 list 验证语义）
//   C. chatroom 页面：标题显示对方、textarea 渲染、＋ 面板含相册/拍摄
//
// 用法：node tools/e2e_issues_fix.js （开发者工具须已启动且连 automator 端口 9420）

const automator = require('miniprogram-automator');

const OUT = 'D:/商城/.workbuddy/tmp';
const PAGES = [
  '/pages/index/index', '/pages/category/category', '/pages/search/search',
  '/pages/chat/chat', '/pages/mine/mine', '/pages/publish/publish',
  '/pages/detail/detail?id=test', '/pages/edit-profile/edit-profile',
  '/pages/login/login', '/pages/verify/verify', '/pages/agreement/agreement',
  '/pages/credit/credit', '/pages/order/order', '/pages/favorite/favorite',
  '/pages/pickup/pickup',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isCloud = s => typeof s === 'string' && s.startsWith('cloud://');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const errors = [];
  mp.on('console', m => { if (m.type === 'error') errors.push('[console] ' + m.args.join(' ')); });
  mp.on('exception', e => errors.push('[exception] ' + (e.message || JSON.stringify(e))));

  const log = (...a) => console.log(...a);
  let fail = 0;
  const ok = (n) => log('  ✅ ' + n);
  const bad = (n, d) => { fail++; log('  ❌ ' + n + (d ? ' :: ' + String(d).slice(0, 200) : '')); };

  // ---------- A. 全页面 console 报错扫描 ----------
  log('\n=== A. 全页面调试器报错扫描 ===');
  for (const p of PAGES) {
    const b = errors.length;
    try { await mp.reLaunch(p); await sleep(1800); }
    catch (e) { bad('reLaunch ' + p, e.message); }
    const n = errors.length - b;
    if (n === 0) log('  ✅ ' + p);
    else { fail++; log('  ❌ ' + p + ` (${n} 个报错)`); errors.slice(b).forEach(e => log('      ' + e.slice(0, 200))); }
  }

  // ---------- B. 头像转换（读页面 data）----------
  log('\n=== B. 头像 cloud:// → https 转换 ===');

  // chat.convs
  await mp.reLaunch('/pages/chat/chat'); await sleep(2200);
  let d = await (await mp.currentPage()).data();
  let list = (d && d.list) || [];
  const cloudPeers = list.filter(c => c.peerInfo && isCloud(c.peerInfo.avatarUrl));
  if (cloudPeers.length) bad('chat 会话列表存在未转换的 cloud:// 头像', JSON.stringify(cloudPeers[0].peerInfo).slice(0, 120));
  else ok(`chat.convs 头像全部非 cloud://（${list.length} 个会话）`);

  // user.me / login
  await mp.reLaunch('/pages/mine/mine'); await sleep(2200);
  d = await (await mp.currentPage()).data();
  const meAvatar = d.userInfo && d.userInfo.avatarUrl;
  if (isCloud(meAvatar)) bad('mine 我的头像仍是 cloud://（user.me/login 未转换）', meAvatar);
  else ok('mine 我的头像已转 https/空 (' + (meAvatar ? 'https' : '空') + ')');

  // ---------- C. 进聊天页验证 getPublic 头像 + 标题 + 输入栏 ----------
  log('\n=== C. chatroom 页面（getPublic 头像 / 标题 / 输入栏）===');
  await mp.reLaunch('/pages/chat/chat'); await sleep(2200);
  const chatPage = await mp.currentPage();
  const convEl = await chatPage.$('.conv-item');
  if (!convEl) {
    log('  ℹ️  无会话可进，跳过 chatroom 深测（chatroom 加载已纳入 A 扫描）');
  } else {
    await convEl.tap();
    await sleep(2800);
    const cr = await mp.currentPage();
    const path = cr.path || '';
    if (path.indexOf('chatroom') === -1) bad('点击会话未进入 chatroom', 'path=' + path);
    else {
      ok('点击会话进入 chatroom');
      const cd = await cr.data();
      // 标题 = 对方昵称
      if (cd.title && cd.title.length > 1 && cd.title !== '聊天') ok('chatroom 标题显示对方：「' + cd.title + '」');
      else bad('chatroom 标题未显示对方', 'title=' + cd.title);
      // getPublic 头像
      const pa = cd.peerInfo && cd.peerInfo.avatarUrl;
      if (isCloud(pa)) bad('chatroom peerInfo 头像仍是 cloud://（user.getPublic 未转换）', pa);
      else ok('chatroom peerInfo 头像已转 https/空');
      // textarea
      const ta = await cr.$('.ipt');
      ta ? ok('输入框 textarea(.ipt) 已渲染') : bad('未找到输入框 textarea(.ipt)');
      // ＋ 面板：输入栏有两个 .icon-btn（emoji、＋），＋ 为 draft 为空时的第二个
      const iconBtns = await cr.$$('.icon-btn');
      const plusBtn = iconBtns && iconBtns[1];
      if (plusBtn) {
        await plusBtn.tap(); await sleep(600);
        const items = await cr.$$('.plus-item');
        if (items && items.length >= 2) ok('＋ 面板含「相册/拍摄」两项 (' + items.length + ')');
        else bad('＋ 面板项不足', items ? items.length : 0);
      } else bad('未找到 ＋ 按钮（draft 为空时应显示）');
      await mp.screenshot({ path: OUT + '/e2e_chatroom.png' });
    }
  }

  // ---------- B2. 分类页四种排序（点击筛选条，验证真实交互）----------
  log('\n=== B2. 分类页四种排序 ===');
  try {
    await mp.reLaunch('/pages/category/category'); await sleep(3200);
    const cat = await mp.currentPage();
    // 筛选条顺序：最新(new) / 价低(priceAsc) / 价高(priceDesc) / 热门(hot)
    const order = [
      { i: 0, s: 'new', label: '最新' },
      { i: 1, s: 'priceAsc', label: '价低' },
      { i: 2, s: 'priceDesc', label: '价高' },
      { i: 3, s: 'hot', label: '热门' },
    ];
    for (const o of order) {
      try {
        const items = await cat.$$('.filter-item');
        if (!items || !items[o.i]) { bad(`找不到第 ${o.i} 个筛选条`, ''); continue; }
        await items[o.i].tap();
        await sleep(3500);
        const cd = await cat.data();
        const l = (cd && cd.list) || [];
        if (!Array.isArray(l)) { bad(`sort=${o.s} 列表非数组`, JSON.stringify(cd).slice(0, 120)); continue; }
        ok(`sort=${o.s}(${o.label}) 返回 ${l.length} 条`);
        if (o.s === 'new' && l.length >= 2) {
          let desc = true;
          for (let i = 1; i < l.length; i++) if ((l[i].createdAt || 0) > (l[i - 1].createdAt || 0)) desc = false;
          desc ? ok('「最新」按发布时间倒序正确') : bad('「最新」未按发布时间倒序');
        }
        if (o.s === 'priceAsc' && l.length >= 2) {
          const ps = l.map(g => g.price).filter(v => typeof v === 'number');
          let asc = true;
          for (let i = 1; i < ps.length; i++) if (ps[i] < ps[i - 1]) asc = false;
          asc ? ok('「价低」价格升序正确') : bad('「价低」未按价格升序');
        }
        if (o.s === 'priceDesc' && l.length >= 2) {
          const ps = l.map(g => g.price).filter(v => typeof v === 'number');
          let desc = true;
          for (let i = 1; i < ps.length; i++) if (ps[i] > ps[i - 1]) desc = false;
          desc ? ok('「价高」价格降序正确') : bad('「价高」未按价格降序');
        }
      } catch (e) { bad(`sort=${o.s} 交互异常`, e.message); }
    }
  } catch (e) { bad('分类页加载/排序测试异常', e.message); }

  // ---------- 汇总 ----------
  log('\n=== 汇总 ===');
  log(`console 报错总数: ${errors.length}`);
  errors.slice(0, 20).forEach(e => log('  ' + e.slice(0, 200)));
  log(`失败项: ${fail}`);
  await mp.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
