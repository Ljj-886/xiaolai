// tools/diag_detail.js —— 通过真实点击进入详情页，验证详情页图片已解析
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
}

(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    // 从首页点第一张商品卡进详情
    await mp.reLaunch('/pages/index/index');
    let home = await mp.currentPage();
    let cards = [];
    for (let i = 0; i < 12; i++) {
      await wait(2000);
      home = await mp.currentPage();
      const st = await evalSafe(mp, () => {
        const p = getCurrentPages().slice(-1)[0];
        return { route: p && p.route, len: (p && p.data.list || []).length, loading: p && p.data.loading, err: p && p.data.loadError };
      });
      if (i === 0 || st.len) out.indexState = st;
      if (st && st.len) {
        for (const sel of ['goods-card', '.gc', '.grid-cell', 'view']) {
          cards = await home.$$(sel);
          if (cards && cards.length) { out.tapSel = sel; break; }
        }
        if (cards && cards.length) { out.indexState = st; break; }
      }
    }
    out.cardCount = cards && cards.length;
    if (cards && cards.length) {
      await cards[0].tap();
      await wait(6000);
      const dp = await mp.currentPage();
      out.detail = await evalSafe(mp, () => {
        const p = getCurrentPages().slice(-1)[0];
        const it = (p && p.data && p.data.item) || {};
        const s = v => (!v ? '(空)' : String(v).slice(0, 42));
        return {
          route: p && p.route, id: s(it._id), title: it.title,
          cover: s(it.cover),
          images: (it.images || []).map(x => s(x))
        };
      });
      console.log('[detail]', JSON.stringify(out.detail));
      try { await mp.screenshot({ path: path.join(__dirname, '_d_detail.png') }); out.shot = true; } catch (e) { out.shot = String(e.message); }
    } else {
      out.err = '首页无商品卡';
    }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
