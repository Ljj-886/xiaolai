// tools/test_round3.js
// 第三轮回归：管理后台扩展 / 敏感词（服务端+云函数）/ 学员认证学历字段
const automator = require('miniprogram-automator');

async function withMp(fn) {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  try { return await fn(mp); }
  finally { try { await mp.disconnect(); } catch (_) {} }
}

(async () => {
  console.log('=== Round3 回归测试（管理后台 / 敏感词 / 学历字段） ===\n');
  let pass = 0, fail = 0, skip = 0;
  const ok = (n, cond, detail) => {
    if (cond) { pass++; console.log('  ✅', n); }
    else { fail++; console.log('  ❌', n, detail || ''); }
  };
  const skip1 = (n, why) => { skip++; console.log('  ⏭️ ', n, '（', why, '）'); };

  await withMp(async mp => {

    // ====== A. 敏感词版本 ======
    console.log('\n[A] 敏感词版本与命中');
    const sensRes = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({
        name: 'admin', data: { action: 'checkSensitive', text: '卖一只仿真枪模型可击发' }
      });
      return r.result && r.result.data;
    });
    ok('checkSensitive 命中「仿真枪」', sensRes && sensRes.hits && sensRes.hits.length > 0, JSON.stringify(sensRes));
    ok('敏感词版本 v3-2026-09', sensRes && sensRes.version === 'v3-2026-09', sensRes && sensRes.version);

    // ====== B. 正常文本不误杀 ======
    console.log('\n[B] 正常文本不误杀');
    const normalCases = [
      '出售高数教材 同济第七版 功课笔记齐全',
      '保本出 全新 iPad Air 256G',
      'SK-II 神仙水小样 30ml 正品',
      '水枪玩具 夏天宿舍降暑 儿童礼物',
      '1991年学姐 考研政治资料',
      '搬家出售 银河系天文学导论课本',
      '蓝牙耳机 BT5.2 低延迟',
      '115元出 三国杀桌游 全套卡牌'
    ];
    let fp = 0;
    for (const t of normalCases) {
      const r = await mp.evaluate(async (text) => {
        const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'checkSensitive', text } });
        return res.result && res.result.data;
      }, t);
      if (r && r.hits && r.hits.length) { fp++; console.log('    误杀:', t, '=>', r.hits); }
    }
    ok('正常二手文案零误杀', fp === 0, `${fp} 例误杀`);

    // ====== C. 商品发布：服务端敏感词拦截 ======
    console.log('\n[C] 商品发布敏感词拦截');
    try {
      const r = await mp.evaluate(async () => {
        const res = await wx.cloud.callFunction({
          name: 'goods', data: {
            action: 'publish',
            title: '出售高仿奢侈品A货',
            desc: '做工精致 跟真品一模一样',
            images: ['cloud://fake'],
            price: 99, category: 'other'
          }
        });
        return res.result;
      });
      ok('发布「高仿/A货」被服务端拦截', r && r.code !== 0 && /违禁词|敏感/.test(r.msg || ''), JSON.stringify(r));
    } catch (e) { ok('发布敏感词触发异常', false, e.message); }

    // ====== D. 私聊敏感词拦截（需真实 peer；没有则跳过） ======
    console.log('\n[D] 私聊敏感词拦截');
    const otherUser = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({ name: 'login' });
      const myOpenid = r.result.data.openid;
      const db = wx.cloud.database();
      const users = await db.collection('users').limit(50).get();
      return users.data.find(u => u._openid && u._openid !== myOpenid) || null;
    });
    if (!otherUser) {
      skip1('私聊敏感词拦截', '需要第二个微信号才能测');
    } else {
      const peerGoods = await mp.evaluate(async (peerOpenid) => {
        const db = wx.cloud.database();
        const r = await db.collection('goods').where({ _openid: peerOpenid, status: 'onSale' }).limit(1).get();
        return r.data[0] || null;
      }, otherUser._openid);
      if (!peerGoods) skip1('私聊敏感词拦截', '对方没有在售商品');
      else {
        const r = await mp.evaluate(async ({ peerOpenid, goodsId }) => {
          const res = await wx.cloud.callFunction({
            name: 'chat', data: {
              action: 'send', peerOpenid, goodsId,
              type: 'text', content: '加微信详聊 vx12345'
            }
          });
          return res.result;
        }, { peerOpenid: otherUser._openid, goodsId: peerGoods._id });
        ok('私聊发「加微信」被拦截', r && r.code !== 0 && /违禁词|敏感/.test(r.msg || ''), JSON.stringify(r));
      }
    }

    // ====== E. 学员认证学历字段 ======
    console.log('\n[E] 学员认证学历字段');
    // 先检查当前账号是否已认证；若已认证则学历字段校验走不到（前置已拦截）
    const meNow = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({ name: 'user', data: { action: 'me' } });
      return r.result && r.result.data;
    });
    if (meNow && meNow.verified) {
      skip1('学历「高中」应被拒', '当前账号已认证，前置拦截生效（正确）');
      skip1('缺学信网截图应被拒', '当前账号已认证，前置拦截生效（正确）');
    } else {
      // E.1 非法学历应被拒
      const eduBad = await mp.evaluate(async () => {
        const r = await wx.cloud.callFunction({
          name: 'user', data: {
            action: 'applyVerify',
            realName: '测试', studentId: '2024001', school: '示例大学',
            email: '', education: '高中',
            evidence: ['cloud://fake']
          }
        });
        return r.result;
      });
      ok('学历「高中」应被拒', eduBad && eduBad.code !== 0 && /学历/.test(eduBad.msg || ''), JSON.stringify(eduBad));

      // E.2 缺学信网截图应被拒
      const noEv = await mp.evaluate(async () => {
        const r = await wx.cloud.callFunction({
          name: 'user', data: {
            action: 'applyVerify',
            realName: '测试', studentId: '2024001', school: '示例大学',
            email: '', education: '本科'
          }
        });
        return r.result;
      });
      ok('缺学信网截图应被拒', noEv && noEv.code !== 0 && /学信网|凭证/.test(noEv.msg || ''), JSON.stringify(noEv));
    }
    // E.3 合法学历 + 学信网截图 → 应进入 pending（或已存在 pending）
    const eduGood = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({
        name: 'user', data: {
          action: 'applyVerify',
          realName: '测试同学', studentId: '2024002', school: '示例大学',
          email: '', education: '硕士',
          evidence: ['cloud://fake_chsi_screenshot']
        }
      });
      return r.result;
    });
    const accepted = eduGood && eduGood.code === 0;
    const rejectedAlready = eduGood && /已通过|审核中|已存在/.test(eduGood.msg || '');
    ok('合法学历+学信网截图被受理', accepted || rejectedAlready, JSON.stringify(eduGood));

    // ====== F. 用户/商品列表 ======
    console.log('\n[F] admin.listUsers / listGoods');
    const u = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({ name: 'admin', data: { action: 'listUsers', pageSize: 5 } });
      return r.result && r.result.data;
    });
    ok('listUsers 返回 list', u && Array.isArray(u.list), JSON.stringify(u).slice(0, 100));
    ok('listUsers 每条有 _openid', u && u.list && u.list.length > 0 ? !!u.list[0]._openid : true);

    const g = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({ name: 'admin', data: { action: 'listGoods', status: 'onSale', pageSize: 5 } });
      return r.result && r.result.data;
    });
    ok('listGoods onSale 返回', g && Array.isArray(g.list), JSON.stringify(g).slice(0, 100));

    // ====== G. clearUser 守卫 ======
    console.log('\n[G] clearUser 安全守卫');
    const clr = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({
        name: 'admin', data: { action: 'clearUser', openid: 'o5NAjxrVqSopwCl-rnh0cwjv1auE', reason: '测试守卫' }
      });
      return r.result;
    });
    ok('白名单管理员不可被清除', clr && clr.code !== 0 && /白名单|不可/.test(clr.msg || ''), JSON.stringify(clr));

    // ====== H. stats 返回新字段 ======
    console.log('\n[H] admin.stats');
    const stats = await mp.evaluate(async () => {
      const r = await wx.cloud.callFunction({ name: 'admin', data: { action: 'stats' } });
      return r.result && r.result.data;
    });
    ok('stats.users 字段存在', stats && typeof stats.users === 'number', JSON.stringify(stats));
    ok('stats.banned 字段存在（新）', stats && typeof stats.banned === 'number');
    ok('stats.off 字段存在（新）', stats && typeof stats.off === 'number');
    ok('stats.pendingVerify 字段存在（新）', stats && typeof stats.pendingVerify === 'number');

  });

  console.log(`\n=== 汇总：${pass} 通过 / ${fail} 失败 / ${skip} 跳过 ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n❌ 测试脚本异常:', e.message);
  process.exit(1);
});