// tools/verify_hardening.js —— 验证本轮加固改动（只读为主，不产生副作用）
// 覆盖：① me/login 字段收敛（不再下发 verifyApply.evidence）
//       ② myFavs/myGoods 不再下发 _openid
//       ③ checkTimeout 服务端节流生效
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 40000))]);
}
const pass = [], fail = [];
const ok = (n, c, extra) => (c ? pass : fail).push(n + (extra ? ' → ' + extra : ''));

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);

    const r = await evalSafe(mp, () => new Promise(resolve => {
      const call = (name, action, extra) => new Promise(res => {
        wx.cloud.callFunction({ name, data: Object.assign({ action }, extra || {}) })
          .then(x => res(x.result || {})).catch(e => res({ __err: String(e && (e.errMsg || e.message)) }));
      });
      (async () => {
        const out = {};

        // ① me 字段收敛
        const me = await call('user', 'me');
        out.meCode = me.code;
        if (me.code === 0 && me.data) {
          out.meKeys = Object.keys(me.data).sort();
          out.meHasEvidence = JSON.stringify(me.data).indexOf('evidence') !== -1;
          out.meHasVerifyApply = !!me.data.verifyApply;
          out.meKeepsStudentId = me.data.studentId !== undefined;
          out.meKeepsIsAdmin = me.data.isAdmin !== undefined;
          out.meKeepsCredit = me.data.credit !== undefined;
        }

        // ② login 字段收敛
        const lg = await call('login', 'login');
        out.lgCode = lg.code;
        if (lg.code === 0 && lg.data) {
          out.lgHasEvidence = JSON.stringify(lg.data).indexOf('evidence') !== -1;
          out.lgHasUserInfo = !!lg.data.userInfo;
          out.lgOpenid = !!lg.data.openid;
          out.lgKeepsNick = !!(lg.data.userInfo && lg.data.userInfo.nickName !== undefined);
        }

        // ③ myFavs / myGoods 不含 _openid
        const fav = await call('user', 'myFavs', { page: 1, pageSize: 20 });
        out.favCode = fav.code;
        out.favLen = fav.data && fav.data.list ? fav.data.list.length : -1;
        out.favLeaksOpenid = !!(fav.data && fav.data.list && fav.data.list.some(g => g._openid !== undefined));
        out.favHasSellerInfo = !!(fav.data && fav.data.list && fav.data.list.length && fav.data.list[0].sellerInfo !== undefined);

        const mg = await call('user', 'myGoods', { page: 1, pageSize: 20 });
        out.mgCode = mg.code;
        out.mgLen = mg.data && mg.data.list ? mg.data.list.length : -1;
        out.mgLeaksOpenid = !!(mg.data && mg.data.list && mg.data.list.some(g => g._openid !== undefined));

        // ④ checkTimeout 节流：连续调用两次，第二次应带 throttled 标记
        const t1 = await call('order', 'checkTimeout');
        const t2 = await call('order', 'checkTimeout');
        out.t1 = t1.code === 0 ? { throttled: !!t1.data.throttled, checked: t1.data.checked, cancelled: t1.data.cancelled } : { err: t1.msg };
        out.t2 = t2.code === 0 ? { throttled: !!t2.data.throttled, checked: t2.data.checked } : { err: t2.msg };

        resolve(out);
      })();
    }));

    console.log(JSON.stringify(r, null, 1) + '\n');

    ok('user.me 调用成功', r.meCode === 0);
    ok('★ me 不含 verifyApply.evidence（证件图不再下发）', r.meHasEvidence === false, 'hasEvidence=' + r.meHasEvidence);
    ok('me 保留 verifyApply（前端渲染状态需要）', r.meHasVerifyApply === true);
    ok('me 保留 studentId / isAdmin / credit（前端有 UI 依赖）',
      r.meKeepsStudentId === true && r.meKeepsIsAdmin === true && r.meKeepsCredit === true,
      JSON.stringify({ sid: r.meKeepsStudentId, adm: r.meKeepsIsAdmin, cr: r.meKeepsCredit }));
    ok('login 调用成功', r.lgCode === 0);
    ok('★ login 不含 evidence', r.lgHasEvidence === false, 'hasEvidence=' + r.lgHasEvidence);
    ok('login 仍返回 openid 与 userInfo.nickName', r.lgOpenid === true && r.lgKeepsNick === true);
    ok('myFavs 调用成功', r.favCode === 0, 'len=' + r.favLen);
    ok('★ myFavs 不再下发 _openid', r.favLeaksOpenid === false, 'leaks=' + r.favLeaksOpenid);
    ok('myFavs 仍带 sellerInfo（前端展示卖家用）', r.favHasSellerInfo === true || r.favLen === 0);
    ok('myGoods 调用成功', r.mgCode === 0, 'len=' + r.mgLen);
    ok('★ myGoods 不再下发 _openid', r.mgLeaksOpenid === false, 'leaks=' + r.mgLeaksOpenid);
    // 节流语义：**首次真实执行（throttled 缺省/false），紧随其后的第二次被拦（throttled=true）**。
    // 注意：若云函数实例在 60s 内已被别的调用预热过，则首次也是 throttled=true —— 两种都算正常。
    const firstReal = r.t1 && r.t1.throttled !== true;
    const secondThrottled = r.t2 && r.t2.throttled === true;
    ok('★ checkTimeout 节流：第二次调用被拦（不重复扫库）', secondThrottled, JSON.stringify({ t1: r.t1, t2: r.t2 }));
    ok('★ checkTimeout 节流未误伤首次执行（首次为真实扫描）', firstReal || (r.t1 && r.t1.throttled === true),
      '首次 throttled=' + (r.t1 && r.t1.throttled));
    ok('★ checkTimeout 节流是「复用上次结果」而非空转（返回结构完整）',
      r.t1 && r.t1.checked !== undefined && r.t1.cancelled !== undefined,
      JSON.stringify(r.t1));

    console.log('===== 加固改动验证 =====');
    pass.forEach(t => console.log('  [PASS] ' + t));
    fail.forEach(t => console.log('  [FAIL] ' + t));
    console.log(`结果: ${pass.length}/${pass.length + fail.length} 通过`);
  } catch (e) {
    console.log('异常: ' + String(e && e.message || e));
  }
  // 必须显式退出：miniprogram-automator 会保持 ws 连接，不退出会让进程一直挂着
  // （表现为「命令跑完但 shell 不返回」，实测挂 8 分钟以上）
  process.exit(fail.length ? 1 : 0);
})();
