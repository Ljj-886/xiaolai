// tools/test_round4.js — 校园认证可修改 + 学历从专科开始
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  let pass = 0, failCount = 0;
  const ok = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  => ' + (extra || '')));
    cond ? pass++ : failCount++;
  };

  // 拿到自己的 openid（login 云函数）
  const myOpenid = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({ name: 'login', data: {} });
    return r.result && (r.result.openid || (r.result.data && r.result.data.openid));
  });
  ok('获取 openid', !!myOpenid, String(myOpenid));

  // A. 管理员先通过当前 pending 申请（同时验证 realName/education 同步）
  console.log('\n[A] 审核通过 → 字段同步');
  const approve = await mp.evaluate(async (openid) => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: { action: 'reviewVerify', targetOpenid: openid, pass: true }
    });
    return r.result;
  }, myOpenid);
  ok('管理员通过认证', approve && approve.code === 0, JSON.stringify(approve));

  const me1 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({ name: 'user', data: { action: 'me' } });
    return r.result.data;
  });
  ok('verified = true', me1.verified === true);
  ok('school 同步', me1.school === '示例大学', me1.school);
  ok('studentId 同步', me1.studentId === '2024099', String(me1.studentId));
  ok('realName 同步', me1.realName === '重测同学', String(me1.realName));
  ok('education 同步', me1.education === '本科', String(me1.education));

  // B. 已认证用户重新提交认证（核心需求：可以修改）
  console.log('\n[B] 已认证用户重新提交认证');
  const r1 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: {
        action: 'applyVerify',
        realName: '改名同学', studentId: '2024100', school: '新大学',
        email: '', education: '硕士',
        evidence: ['cloud://fake_chsi_resubmit2']
      }
    });
    return r.result;
  });
  ok('已认证用户可重新提交（不再被「已通过认证」拦截）', r1 && r1.code === 0, JSON.stringify(r1));
  ok('返回 resubmit 标记', r1 && r1.data && r1.data.resubmit === true, JSON.stringify(r1));

  // 重新提交后：verified 应保持 true（原认证继续有效，等管理员再审）
  const me2 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({ name: 'user', data: { action: 'me' } });
    return { verified: r.result.data.verified, st: r.result.data.verifyApply && r.result.data.verifyApply.status };
  });
  ok('重新提交后原认证仍有效（verified 保持 true）', me2.verified === true, JSON.stringify(me2));
  ok('新申请进入 pending', me2.st === 'pending', JSON.stringify(me2));

  // C. 学历低于专科仍被拒（防绕过）
  const r2 = await mp.evaluate(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user', data: {
        action: 'applyVerify',
        realName: 'x', studentId: '1', school: 'y',
        email: '', education: '高中',
        evidence: ['cloud://fake']
      }
    });
    return r.result;
  });
  ok('学历「高中」被拒（认证从专科起）', r2 && r2.code !== 0 && /学历/.test(r2.msg || ''), JSON.stringify(r2));

  // D. verify 页面：学历选项从专科开始 + 已认证用户表单可用（预填当前信息）
  console.log('\n[D] 认证页');
  const page = await mp.reLaunch('/pages/verify/verify');
  await new Promise(r => setTimeout(r, 2500));
  const data = await page.data();
  ok('学历选项第一项为专科', Array.isArray(data.educations) && data.educations[0] === '专科', JSON.stringify(data.educations));
  ok('预填当前认证信息', data.form && data.form.realName === '改名同学', JSON.stringify(data.form));
  // 已认证用户页面不再隐藏提交按钮：wxml 中 bottom-bar 不再有 verified 条件
  const submitBtn = await page.$('.bottom-bar .btn');
  ok('已认证用户仍显示提交按钮', !!submitBtn);

  console.log(`\n结果: ${pass} 通过 / ${failCount} 失败`);
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
