// tools/test_round5.js — 双认证自动校验 + 微信强制登录 + 管理后台 4 卡可点
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  let pass = 0, failCount = 0;
  const ok = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  => ' + (extra || '')));
    cond ? pass++ : failCount++;
  };

  // ============== A. 自动校验字段格式 ==============
  console.log('\n[A] 自动校验字段格式');
  // A.1 合法数据应通过自动校验
  const r1 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: {
        action: 'applyVerify',
        realName: '测试同学', studentId: '2024110', school: '示例大学',
        education: '本科',
        evidence: ['cloud://fake_chsi_a1']
      }
    });
    return r.result;
  });
  ok('合法字段通过自动校验', r1 && r1.code === 0, JSON.stringify(r1));
  ok('返回 autoVerified=true', r1 && r1.data && r1.data.autoVerified === true, JSON.stringify(r1));

  // A.2 姓名格式错误应被拒
  const r2 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: {
        action: 'applyVerify',
        realName: 'a', studentId: '2024111', school: '示例大学',
        education: '本科',
        evidence: ['cloud://fake_chsi_a2']
      }
    });
    return r.result;
  });
  ok('姓名格式错误被拒', r2 && r2.code !== 0 && /姓名/.test(r2.msg || ''), JSON.stringify(r2));

  // A.3 学号过短被拒
  const r3 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: {
        action: 'applyVerify',
        realName: '测试', studentId: '12345', school: '示例大学',
        education: '本科',
        evidence: ['cloud://fake']
      }
    });
    return r.result;
  });
  ok('学号位数过短被拒', r3 && r3.code !== 0 && /学号/.test(r3.msg || ''), JSON.stringify(r3));

  // A.4 缺学校被拒
  const r4 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: {
        action: 'applyVerify',
        realName: '测试', studentId: '2024112', school: '',
        education: '本科',
        evidence: ['cloud://fake']
      }
    });
    return r.result;
  });
  ok('缺学校被拒', r4 && r4.code !== 0 && /学校/.test(r4.msg || ''), JSON.stringify(r4));

  // A.5 学历低于专科被拒
  const r5 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: {
        action: 'applyVerify',
        realName: '测试', studentId: '2024113', school: '示例大学',
        education: '高中',
        evidence: ['cloud://fake']
      }
    });
    return r.result;
  });
  ok('高中学历被拒（专科起点）', r5 && r5.code !== 0 && /学历/.test(r5.msg || ''), JSON.stringify(r5));

  // A.6 管理员 listPendingVerify 能看到 autoVerified 标记
  const list = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({ name: 'user', data: { action: 'listPendingVerify' } });
    return r.result && r.result.data && r.result.data.list;
  });
  const verifiedItem = (list || []).find(it => it.apply && it.apply.studentId === '2024110');
  ok('管理员列表看到 autoVerified=true', verifiedItem && verifiedItem.apply.autoVerified === true, JSON.stringify(verifiedItem && verifiedItem.apply));

  // ============== B. 微信强制登录拦截 ==============
  console.log('\n[B] 微信登录态拦截');
  const minePage = await mp.reLaunch('/pages/mine/mine');
  await new Promise(r => setTimeout(r, 1500));
  const mineData = await minePage.data();
  // 当前测试机用的是管理员账号，openid 已缓存，应该 logged=true
  ok('已登录态 mine.logged=true', mineData.logged === true, 'logged=' + mineData.logged);

  // edit-profile 不再有 chooseAvatar 按钮（已登录后不再显示）
  const editPage = await mp.navigateTo('/pages/edit-profile/edit-profile');
  await new Promise(r => setTimeout(r, 1000));
  const chooseBtn = await editPage.$('button[open-type="chooseAvatar"]');
  ok('edit-profile 登录后不显示「使用微信头像」按钮', !chooseBtn);

  // ============== C. 管理后台 4 卡片跳转 ==============
  console.log('\n[C] 管理后台数字卡可点击');
  const adminPage = await mp.navigateTo('/pages/admin/admin');
  await new Promise(r => setTimeout(r, 1500));
  const tabs = await adminPage.$$('.stats-grid .stat-tap');
  ok('4 张可点击卡片渲染', tabs.length === 4, 'count=' + tabs.length);

  // 模拟点击「已售」卡片 → goods tab + sold filter
  await adminPage.tap ? null : null; // 用 evaluate 触发
  await mp.evaluate(() => {
    const pages = getCurrentPages();
    const pg = pages[pages.length - 1];
    pg.quickNav({ currentTarget: { dataset: { target: 'goods', s: 'sold' } } });
  });
  await new Promise(r => setTimeout(r, 1500));
  const afterNav = await adminPage.data();
  ok('点击已售→切换到 goods tab', afterNav.tab === 'goods', 'tab=' + afterNav.tab);
  ok('点击已售→filter=sold', afterNav.goodsStatus === 'sold', 'goodsStatus=' + afterNav.goodsStatus);

  await mp.evaluate(() => {
    const pages = getCurrentPages();
    const pg = pages[pages.length - 1];
    pg.quickNav({ currentTarget: { dataset: { target: 'users', s: 'pending' } } });
  });
  await new Promise(r => setTimeout(r, 1500));
  const afterNav2 = await adminPage.data();
  ok('点击待认证→切换到 users tab', afterNav2.tab === 'users', 'tab=' + afterNav2.tab);
  ok('点击待认证→filter=pending', afterNav2.userStatusFilter === 'pending', 'userStatusFilter=' + afterNav2.userStatusFilter);

  // ============== D. login 云函数 decodePhone action 分发 ==============
  console.log('\n[D] login 云函数 action 分发');
  const loginAction = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({ name: 'login', data: { action: 'decodePhone', code: '' } });
    return r.result;
  });
  ok('decodePhone 缺少 code 应被拒', loginAction && loginAction.code !== 0, JSON.stringify(loginAction));

  const loginOk = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({ name: 'login', data: {} });
    return r.result && r.result.code === 0 ? r.result.data : null;
  });
  ok('默认 login 流程仍能跑通', !!loginOk && !!loginOk.openid, JSON.stringify(loginOk));

  console.log(`\n结果: ${pass} 通过 / ${failCount} 失败`);
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });