// tools/verify_admin_logs.js —— 验证后台「操作日志」入口：先造一条审计记录，再确认能在后台看到
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}

(async () => {
  const out = { checks: [] };
  const chk = (n, p, d) => { out.checks.push({ n, p, d }); console.log((p ? '✅' : '❌') + ' ' + n + ' — ' + d); };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 1) 先确认 adminLogs 接口不再 500（此前是 -502005）
    const lg = await rawCF(mp, 'admin', { action: 'adminLogs', page: 1, pageSize: 20 });
    chk('admin.adminLogs 不再 500', lg && (lg.code === 0 || lg.code === -1), `code=${lg && lg.code} ${lg && lg.msg || ''}`);

    // 2) 造一条审计记录（查看用户敏感资料会落审计）
    const me = await rawCF(mp, 'user', { action: 'me' });
    const meOpenid = (me.data && me.data._openid) || '';
    const ul = await rawCF(mp, 'admin', { action: 'listUsers', page: 1, pageSize: 50 });
    const peer = (((ul.data && ul.data.list) || []).find(u => u._openid !== meOpenid) || {})._openid;
    if (peer) {
      const gd = await rawCF(mp, 'admin', { action: 'getUserDetail', openid: peer });
      out.getUserDetail = gd && gd.code;
      chk('触发审计记录（查看用户敏感资料）', gd && gd.code === 0, `code=${gd && gd.code}`);
    } else {
      chk('触发审计记录', false, '没有其他用户');
    }

    // 3) 进后台，展开操作日志
    await mp.reLaunch('/pages/admin/admin');
    await wait(7000);
    const before = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p && p.route, hasToggle: typeof p.toggleLogs === 'function', logsOpen: p && p.data.logsOpen };
    });
    chk('后台页面存在「操作日志」开关', before && before.route === 'pages/admin/admin' && before.hasToggle,
      JSON.stringify(before));

    const opened = await evalSafe(mp, () => new Promise(resolve => {
      const p = getCurrentPages().slice(-1)[0];
      Promise.resolve(p.toggleLogs()).then(() => resolve(true));
    }));
    await wait(4000);
    const st = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.logs) || [];
      return { logsOpen: p && p.data.logsOpen, logsLoading: p && p.data.logsLoading, count: l.length, first: l[0] || null };
    });
    out.logState = st;
    chk('展开后能加载到审计记录', st && st.logsOpen === true && st.count > 0,
      `展开=${st && st.logsOpen} 加载中=${st && st.logsLoading} 记录数=${st && st.count}`);
    chk('记录含中文动作说明与时间', !!(st && st.first && st.first.actionText && st.first.timeText),
      st && st.first ? `${st.first.timeText} / ${st.first.actionText} / …${st.first.targetText}` : '(无)');

    // 截图放到断言之后（mp.screenshot 会干扰 IDE 页面栈）
    try { await mp.screenshot({ path: path.join(__dirname, '_al_admin.png') }); out.shot = true; }
    catch (e) { out.shot = String(e && e.message || e); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
