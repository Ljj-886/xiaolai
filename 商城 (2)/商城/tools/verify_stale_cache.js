// tools/verify_stale_cache.js —— 决定性验证「过期图链缓存」不会再被渲染
// 手法：往 storage 注入一份 cm_home_list_v1，其 cover 的临时链接签发时间为 20 分钟前（已 403），
//       _id 用 FAKE_ 前缀便于识别。若修复生效，页面应拒绝该缓存（列表里不出现 FAKE_ 项），
//       改用网络新拉的数据（cover 的 t 为刚刚）。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
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

    // 1) 注入「图链已过期」的假缓存（20 分钟前签发）
    const inject = await evalSafe(mp, () => {
      const oldT = Math.floor(Date.now() / 1000) - 20 * 60;
      const host = 'https://636c-cloud1-d6gxmdbcqf5d51f3e-1479199796.tcb.qcloud.la/goods/';
      const list = [1, 2, 3].map(i => ({
        _id: 'FAKE_STALE_' + i,
        title: 'FAKE', price: 1, cover: host + 'fake' + i + '.png?sign=deadbeef' + i + '&t=' + oldT
      }));
      wx.setStorageSync('cm_home_list_v1', {
        at: Date.now(), urlAt: oldT * 1000, type: 'sell',
        list, page: 2, hasMore: true, sig: 'FAKE_STALE_1,FAKE_STALE_2,FAKE_STALE_3'
      });
      return { oldT, injected: list.length };
    });
    out.inject = inject;
    chk('已注入过期图链缓存', inject && inject.injected === 3, `t=${inject && inject.oldT}（20 分钟前）`);

    // 2) 打开首页
    await mp.reLaunch('/pages/index/index');
    await wait(10000);

    const st = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data.list) || [];
      const urlAt = l.map(x => Number(((String(x.cover || '').match(/[?&]t=(\d+)/) || [])[1]) || 0)).filter(Boolean);
      return {
        route: p && p.route, len: l.length, loading: p && p.data.loading,
        ids: l.map(x => x._id),
        fakeCount: l.filter(x => String(x._id).indexOf('FAKE_STALE_') === 0).length,
        urlAges: urlAt.map(t => Math.round(Date.now() / 1000 - t)),
        covers: l.map(x => x.cover)
      };
    });
    out.pageState = { ...st, covers: undefined };
    console.log('[page]', JSON.stringify({ route: st.route, len: st.len, fakeCount: st.fakeCount, urlAges: st.urlAges }));

    chk('页面不再渲染过期缓存（无 FAKE_ 项）', st.fakeCount === 0, `FAKE 项 ${st.fakeCount} / 共 ${st.len} 条`);
    chk('页面拿到了新列表', st.len > 0, `${st.len} 条`);
    const maxAge = st.urlAges.length ? Math.max(...st.urlAges) : -1;
    chk('图链是刚签发的（<5 分钟）', st.urlAges.length > 0 && maxAge < 300, `图链年龄 ${st.urlAges.join('/')} 秒`);

    // 3) 实际请求这些图链
    const probe = await evalSafe(mp, (urls) => new Promise(resolve => {
      const r = []; let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(r);
        const u = urls[i++];
        wx.request({ url: u, method: 'GET', responseType: 'text',
          success: x => { const b = typeof x.data === 'string' ? x.data : ''; r.push({ code: x.statusCode, kb: Math.round(b.length / 1024 * 10) / 10 }); next(); },
          fail: e => { r.push({ fail: String(e && e.errMsg || e) }); next(); } });
      };
      next();
    }), (st.covers || []).slice(0, 5));
    out.probe = probe;
    const bad = (probe || []).filter(x => x.code !== 200).length;
    chk('所有封面图请求返回 200', probe && probe.length > 0 && bad === 0,
      (probe || []).map(x => x.code).join('/') + ' | 体积 ' + (probe || []).map(x => x.kb).join('/') + 'KB');

    // 4) 缓存是否被正确覆盖（urlAt 必须变成新的）
    out.cacheAfter = await evalSafe(mp, () => {
      const c = wx.getStorageSync('cm_home_list_v1') || {};
      return { at: c.at, urlAt: c.urlAt, count: (c.list || []).length, ageMin: c.urlAt ? Math.round((Date.now() - c.urlAt) / 60000) : null };
    });
    console.log('[cache after]', JSON.stringify(out.cacheAfter));
    chk('缓存里的图链时间已更新为最新', out.cacheAfter && out.cacheAfter.urlAt && out.cacheAfter.ageMin <= 1,
      `urlAt 年龄 ${out.cacheAfter && out.cacheAfter.ageMin} 分钟`);

    try { await mp.screenshot({ path: path.join(__dirname, '_stale_index.png') }); out.shot = true; } catch (e) { out.shot = String(e.message); }
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
