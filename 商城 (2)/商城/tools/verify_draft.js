// tools/verify_draft.js —— 验证发布页草稿：填写 → 切走落盘 → 回来恢复 → 可清空
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const KEY = 'cm_publish_draft_v1';
const TITLE = '草稿标题' + Date.now();
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

    // 先清干净
    await evalSafe(mp, (k) => { try { wx.removeStorageSync(k); } catch (e) {} return true; }, KEY);

    // 1) 进发布页，用页面自身的方法填写（等价于用户操作）
    await mp.switchTab('/pages/publish/publish');
    await wait(4000);
    const filled = await evalSafe(mp, (TITLE) => {
      const p = getCurrentPages().slice(-1)[0];
      p.onTitle({ detail: { value: TITLE } });
      p.onDesc({ detail: { value: '草稿描述内容' } });
      p.onPrice({ detail: { value: '12' } });
      p.selectCat({ currentTarget: { dataset: { key: 'book' } } });
      return { route: p.route, title: p.data.form.title, price: p.data.form.price, cat: p.data.form.category };
    }, TITLE);
    console.log('[填写后]', JSON.stringify(filled));
    chk('发布页可正常填写', filled && filled.title === TITLE, JSON.stringify(filled));

    // 2) 切走（触发 onHide 落盘）
    await mp.switchTab('/pages/index/index');
    await wait(2500);
    const draft = await evalSafe(mp, (k) => { const d = wx.getStorageSync(k) || null; return d; }, KEY);
    out.draft = draft;
    chk('切走后草稿已落盘 storage', !!(draft && draft.form && draft.form.title === TITLE),
      draft ? `title=${draft.form.title} at=${draft.at}` : '(无草稿)');

    // 3) 再进发布页 → 应自动恢复
    await mp.switchTab('/pages/publish/publish');
    await wait(4500);
    const restored = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p.route, title: p.data.form.title, desc: p.data.form.desc, price: p.data.form.price, cat: p.data.form.category, type: p.data.form.type };
    });
    out.restored = restored;
    chk('重进发布页自动恢复草稿', restored && restored.title === TITLE && restored.price === '12' && restored.cat === 'book',
      JSON.stringify(restored));

    // 4) 清空：直接调 resetForm（等价于在弹窗里点「清空重填」）
    const cleared = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      p.resetForm();
      return { title: p.data.form.title, type: p.data.form.type, images: p.data.images.length };
    });
    const afterClear = await evalSafe(mp, (k) => { const d = wx.getStorageSync(k); return d === '' || d == null || !d; }, KEY);
    chk('清空后表单复位且草稿已删除',
      cleared && cleared.title === '' && cleared.type === 'sell' && afterClear,
      JSON.stringify(cleared) + ' 草稿已删=' + afterClear);

    // 5) 清理存储
    await evalSafe(mp, (k) => { try { wx.removeStorageSync(k); } catch (e) {} return true; }, KEY);
    try { await mp.screenshot({ path: path.join(__dirname, '_dr_publish.png') }); out.shot = true; } catch (e) { out.shot = String(e.message); }
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
  } finally {
    if (mp) {
      try { await evalSafe(mp, (k) => { try { wx.removeStorageSync(k); } catch (e) {} return true; }, KEY); } catch (e) {}
      try { await mp.close(); } catch (e) {}
    }
  }
  const failed = out.checks.filter(c => !c.p).length;
  console.log('\n===== SUMMARY =====');
  console.log(`通过 ${out.checks.length - failed} / ${out.checks.length}` + (failed ? ` ❌ 失败 ${failed}` : ' ✅ 全部通过'));
  console.log(JSON.stringify(out, null, 2));
})();
