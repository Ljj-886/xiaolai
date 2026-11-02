// tools/e2e_avatar_fix.js
// 接入 DevTools 实际验证头像修复（用户要求「自己实行自己调试」）
//   1. 控制台报错扫描（确保 login/edit-profile/utils/avatar.js 编译没出错）
//   2. 登录页 / 编辑资料页加载验证
//   3. 「失效 http:// 头像」已自动清空（数据库里 test 用户的 http:// 头像应被云函数兜底成空，
//      UI 走默认头像，不再显示灰头像）
//   4. 详情页卖家卡头像展示

const automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const errors = [];
  mp.on('console', m => { if (m.type === 'error') errors.push('[console] ' + m.args.join(' ')); });
  mp.on('exception', e => errors.push('[exception] ' + (e.message || JSON.stringify(e))));

  let fail = 0;
  const ok = n => console.log('  ✅ ' + n);
  const bad = (n, d) => { fail++; console.log('  ❌ ' + n + (d ? ' :: ' + String(d).slice(0, 200) : '')); };

  // ---------- 1. 控制台报错扫描（关键页面） ----------
  console.log('=== 1. 控制台报错扫描（关键页面，确保改动编译过）===');
  const PAGES = ['/pages/index/index', '/pages/login/login', '/pages/edit-profile/edit-profile',
    '/pages/mine/mine', '/pages/chat/chat', '/pages/detail/detail?id=test'];
  for (const p of PAGES) {
    const b = errors.length;
    try { await mp.reLaunch(p); await sleep(2000); } catch (e) { bad('reLaunch ' + p, e.message); }
    if (errors.length - b === 0) ok(p);
    else { bad(p, errors.slice(b).join(' | ')); }
  }

  // ---------- 2. 登录页授权面板 UI ----------
  console.log('\n=== 2. 登录页授权面板 ===');
  await mp.reLaunch('/pages/login/login'); await sleep(2500);
  const loginPage = await mp.currentPage();
  // 点击底部「登录」按钮
  try {
    const loginBtn = await loginPage.$('.btn-primary');
    if (loginBtn) {
      await loginBtn.tap(); await sleep(1500);
      // 弹出授权面板后，校验关键节点
      const chooseBtn = await loginPage.$('button[open-type="chooseAvatar"]');
      chooseBtn ? ok('chooseAvatar 按钮已渲染（<button open-type="chooseAvatar">）') : bad('未找到 chooseAvatar 按钮');
      const nickInput = await loginPage.$('input[type="nickname"]');
      nickInput ? ok('nickname input 已渲染') : bad('未找到 nickname input');
      const agree = await loginPage.$('.auth-agree');
      agree ? ok('协议勾选项已渲染') : bad('未找到协议勾选');
      await mp.screenshot({ path: 'D:/商城/.workbuddy/tmp/fix_login_panel.png' });
    } else bad('未找到登录按钮');
  } catch (e) { bad('登录页交互异常', e.message); }

  // ---------- 3. 失效 http:// 头像已自动清空 ----------
  console.log('\n=== 3. 失效 http:// 头像已自动清空（数据兜底）===');
  await mp.reLaunch('/pages/mine/mine'); await sleep(2500);
  let d = await (await mp.currentPage()).data();
  const myAv = d.user && d.user.avatarUrl;
  if (myAv && myAv.startsWith('http://')) bad('我的头像仍是失效 http://（兜底未生效）', myAv);
  else if (myAv && myAv.startsWith('http')) bad('我的头像仍是 http(s) 临时路径', myAv);
  else ok(`我的头像兜底成功（avatarUrl = ${myAv ? myAv.slice(0, 60) : '空（走默认）'}）`);

  // 卖家卡（详情页 sellerInfo）
  await mp.reLaunch('/pages/index/index'); await sleep(2500);
  d = await (await mp.currentPage()).data();
  // 进详情：找一个有商品的 _id
  const firstId = d && d.list && d.list[0] && d.list[0]._id;
  if (firstId) {
    await mp.reLaunch('/pages/detail/detail?id=' + firstId); await sleep(2500);
    d = await (await mp.currentPage()).data();
    const sellerAv = d.sellerInfo && d.sellerInfo.avatarUrl;
    if (sellerAv && sellerAv.startsWith('http://')) bad('详情页卖家头像仍是失效 http://（goods.decorate 兜底未生效）', sellerAv);
    else ok(`详情页卖家头像兜底成功（${sellerAv ? sellerAv.slice(0, 60) : '空（走默认）'}）`);
    await mp.screenshot({ path: 'D:/商城/.workbuddy/tmp/fix_detail_seller.png' });
  } else {
    console.log('  ℹ️  首页无商品可点详情，跳过详情页验证');
  }

  // 会话列表对方头像
  await mp.reLaunch('/pages/chat/chat'); await sleep(2500);
  d = await (await mp.currentPage()).data();
  const convs = (d && d.list) || [];
  const httpPeer = convs.find(c => c.peerInfo && c.peerInfo.avatarUrl && c.peerInfo.avatarUrl.startsWith('http://'));
  if (httpPeer) bad('会话列表对方头像仍有失效 http://', httpPeer.peerInfo.avatarUrl);
  else ok(`会话列表对方头像兜底成功（${convs.length} 个会话）`);

  // ---------- 汇总 ----------
  console.log('\n=== 汇总 ===');
  console.log(`console 报错: ${errors.length}`); errors.slice(0, 5).forEach(e => console.log('  ' + e.slice(0, 200)));
  console.log(`失败项: ${fail}`);
  await mp.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
