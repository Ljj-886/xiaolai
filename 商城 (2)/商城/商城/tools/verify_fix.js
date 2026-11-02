// tools/verify_fix.js —— 决定性验证：详情页数据契约 + myGoods 图片解析 + 分类筛选
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 25000))]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
const isHttps = v => typeof v === 'string' && v.indexOf('https://') === 0;
const isCloud = v => typeof v === 'string' && v.indexOf('cloud://') === 0;

(async () => {
  const out = { checks: [] };
  const chk = (name, pass, detail) => { out.checks.push({ name, pass, detail }); console.log((pass ? '✅' : '❌') + ' ' + name + ' — ' + detail); };
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // ===== A. 详情页数据契约：goods.detail 必须把 cover + 全部 images 转 https =====
    const gl = await callCF(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    const list = (gl.data && gl.data.list) || [];
    chk('goods.list 可返回', list.length > 0, `${list.length} 条`);
    if (list.length) {
      const id = list[0]._id;
      const gd = await callCF(mp, 'goods', { action: 'detail', id });
      const d = gd && gd.data;
      out.detailSample = { id, cover: d && String(d.cover).slice(0, 40), images: d && (d.images || []).map(x => String(x).slice(0, 40)) };
      chk('goods.detail 返回成功', !!d && !!d._id, d ? `title=${d.title}` : JSON.stringify(gd));
      if (d) {
        chk('详情 cover 已转 https', isHttps(d.cover), String(d.cover).slice(0, 46));
        const imgs = d.images || [];
        const bad = imgs.filter(x => !isHttps(x) && !isCloud(x));
        chk('详情 images 全部为合法 URL', bad.length === 0, `${imgs.length} 张, 非法 ${bad.length}`);
      }
    }

    // ===== B. myGoods：cover 必须转 https（修复点） =====
    const mg = await callCF(mp, 'user', { action: 'myGoods', page: 1, pageSize: 20, status: 'onSale' });
    const ml = (mg.data && mg.data.list) || [];
    const withCover = ml.filter(g => g.cover);
    const coverHttps = withCover.filter(g => isHttps(g.cover));
    const stillCloud = ml.filter(g => isCloud(g.cover));
    chk('myGoods 可返回', ml.length > 0, `${ml.length} 条`);
    chk('myGoods cover 全部转 https（无 cloud://）', withCover.length > 0 && coverHttps.length === withCover.length && stillCloud.length === 0,
      `有封面 ${withCover.length} / https ${coverHttps.length} / 残留 cloud ${stillCloud.length}`);

    // ===== C. myGoods 分类筛选（新增 category 支持） =====
    const cat = ml.map(g => g.category).find(Boolean);
    if (cat) {
      const mc = await callCF(mp, 'user', { action: 'myGoods', page: 1, pageSize: 50, status: 'onSale', category: cat });
      const cl = (mc.data && mc.data.list) || [];
      const allMatch = cl.every(g => g.category === cat);
      chk(`myGoods 分类筛选 category=${cat}`, cl.length > 0 && allMatch, `命中 ${cl.length} 条, 全匹配=${allMatch}`);
    } else {
      chk('myGoods 分类筛选', false, '无可用于测试的 category');
    }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  const failed = out.checks.filter(c => !c.pass).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
