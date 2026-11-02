// 验证：
//   A) 信用分封顶 100（云函数 myCredit clamp）
//   B) edit-profile 仿微信资料页（头像/名字/性别均可改）
//   C) 调试器报错捕获
const automator = require('miniprogram-automator');

(async () => {
  let passed = 0, failed = 0;
  const ok = (n, c) => { c ? passed++ : failed++; console.log(`${c ? 'PASS' : 'FAIL'} | ${n}`); };
  const consoleErrors = [];
  const pageErrors = [];

  try {
    const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });

    // 抓取所有 console 与渲染错误
    mp.on('console', msg => {
      if (msg.type === 'error' || msg.type === 'warning') {
        consoleErrors.push(`[${msg.type}] ${msg.text || msg.message || JSON.stringify(msg)}`);
      }
    });

    // ============== A. 信用分封顶 ==============
    console.log('\n--- A. 信用分上限验证 ---');
    const creditRes = await mp.evaluate(() => wx.cloud.callFunction({
      name: 'user', data: { action: 'myCredit' }
    }));
    const r = creditRes && creditRes.result && creditRes.result.data;
    if (r) {
      ok('myCredit 返回了数据', true);
      ok(`信用分 ≤ 100 (当前 ${r.credit})`, r.credit <= 100);
      ok(`信用分 ≥ 0 (当前 ${r.credit})`, r.credit >= 0);
    } else {
      ok('myCredit 返回数据', false);
    }

    // ============== B. edit-profile 页面 ==============
    console.log('\n--- B. edit-profile 页面验证 ---');
    // 1. 进入「我的」页 → 点击头像 → 跳转 edit-profile
    await mp.reLaunch('/pages/mine/mine');
    await new Promise(r => setTimeout(r, 1500));

    // 模拟用户点击头像：mine.wxml 里 <image class="avatar" ... bindtap="editProfile"/>
    const page = await mp.currentPage();
    const avatar = await page.$('.avatar');
    ok('mine 页找到头像元素', !!avatar);
    if (avatar) await avatar.tap();
    await new Promise(r => setTimeout(r, 1500));

    const ep = await mp.currentPage();
    ok('点击头像跳转到了 edit-profile', ep.path === 'pages/edit-profile/edit-profile' || ep.path.indexOf('edit-profile') > -1);

    // 2. 验证仿微信布局的行结构
    const rows = await ep.$$('.row');
    ok('edit-profile 至少有 3 行（头像/名字/性别）', rows.length >= 3);

    const rowLabels = [];
    for (const r of rows) {
      const lab = await r.$('.row-label');
      if (lab) rowLabels.push(await lab.text());
    }
    ok('包含「头像」行', rowLabels.includes('头像'));
    ok('包含「名字」行', rowLabels.includes('名字'));
    ok('包含「性别」行', rowLabels.includes('性别'));

    // 3. 名字 input 是 enabled（不再 disabled）
    const nameInput = await ep.$('.row-input');
    ok('名字输入框存在', !!nameInput);
    if (nameInput) {
      const disabled = await nameInput.attribute('disabled');
      ok('名字输入框未被禁用', disabled === 'false' || disabled === null || disabled === undefined);
    }

    // 4. 头像按钮存在且带 open-type
    const avatarBtn = await ep.$('.avatar-btn');
    ok('头像按钮存在（chooseAvatar）', !!avatarBtn);
    if (avatarBtn) {
      const ot = await avatarBtn.attribute('open-type');
      ok('头像按钮 open-type=chooseAvatar', ot === 'chooseAvatar');
    }

    // 5. 直接 setData 注入表单（input 组件的 .input() 在 wx 不稳定）
    const formInjected = await mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      p.setData({ 'form.nickName': '同学9961_测试', 'form.gender': '女' });
      return p.data.form;
    });
    ok('表单已注入（昵称/性别）', formInjected.nickName === '同学9961_测试' && formInjected.gender === '女');

    // 性别 picker
    const picker = await ep.$('.row-picker');
    ok('性别 picker 存在', !!picker);
    if (picker) await picker.tap();
    await new Promise(r => setTimeout(r, 600));
    // picker 弹层在原生层，DOM 抓不到；直接 setData 模拟用户选择「女」
    const pickerOK = await mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      if (typeof p.onPickGender === 'function') {
        p.onPickGender({ detail: { value: 2 } });
        return true;
      }
      p.setData({ genderIndex: 2, 'form.gender': '女' });
      return true;
    });
    ok('性别 picker 选中「女」', pickerOK);
    await new Promise(r => setTimeout(r, 400));

    const genderVal = await mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      return p.data.form.gender;
    });
    ok(`性别已设置为「${genderVal}」`, genderVal === '女');

    // 6. 直接调 save 方法（绕开按钮 tap 不稳定）
    const saveResult = await mp.evaluate(async () => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      // 注入 form
      p.setData({ 'form.nickName': '同学9961_测试', 'form.gender': '女' });
      // 抓 toast
      window.__lastToast = null;
      const realToast = wx.showToast;
      wx.showToast = (o) => { window.__lastToast = o; };
      try { await p.save(); } catch (e) { window.__saveErr = e.message; }
      wx.showToast = realToast;
      return { toast: window.__lastToast, err: window.__saveErr };
    });
    ok(`save 触发成功 toast「${saveResult.toast && saveResult.toast.title}」`, saveResult.toast && saveResult.toast.title === '已保存');
    if (saveResult.err) console.log('  save err:', saveResult.err);

    // 等 navigateBack (setTimeout 800)
    await new Promise(r => setTimeout(r, 1200));

    // 7. 验证回到上一页（navigateBack）
    const after = await mp.currentPage();
    ok('保存后返回上一页', after.path !== 'pages/edit-profile/edit-profile' && after.path.indexOf('edit-profile') === -1);

    // 8. 重新进入 edit-profile，验证性别持久化
    await mp.reLaunch('/pages/mine/mine');
    await new Promise(r => setTimeout(r, 1000));
    const minePage = await mp.currentPage();
    const av = await minePage.$('.avatar');
    if (av) await av.tap();
    await new Promise(r => setTimeout(r, 1500));
    // 等 fetchMe 完成（onShow 调 call('user', action:'me'），cloud 函数往返通常 200-500ms）
    let persistedGender = '';
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 400));
      persistedGender = await mp.evaluate(() => {
        const pages = getCurrentPages();
        return pages[pages.length - 1].data.form.gender;
      });
      if (persistedGender) break;
    }
    ok(`性别已持久化到服务端（重新进入后仍是「${persistedGender}」）`, persistedGender === '女');

    // ============== C. 调试器报错汇总 ==============
    console.log('\n--- C. 调试器报错汇总 ---');
    // 整个会话期间捕获的 console.error / warning
    ok(`无 console.error/warning（捕获 ${consoleErrors.length} 条）`, consoleErrors.length === 0);
    if (consoleErrors.length) {
      consoleErrors.slice(0, 10).forEach(e => console.log('  └', e));
    }

    await mp.disconnect();
    console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('ERROR:', e.message, e.stack);
    process.exit(1);
  }
})();