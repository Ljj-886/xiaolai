// 验证 mine 页「清除缓存」按钮：确认弹窗 → 清除指定 storage → toast 提示 → 刷新
const automator = require('miniprogram-automator');

(async () => {
  let passed = 0, failed = 0;
  const ok = (name, cond) => { cond ? passed++ : failed++; console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}`); };

  try {
    const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });

    // 预置脏缓存（含应保留的登录态/表情）
    await mp.evaluate(() => {
      wx.setStorageSync('cm_search_history', ['脏数据']);
      wx.setStorageSync('cm_cat_filter', { key: 'x', name: '脏' });
      wx.setStorageSync('cm_pickup_history', ['脏点']);
      wx.setStorageSync('cm_logged', '1');       // 应保留
      wx.setStorageSync('cm_my_emojis', ['😀']); // 应保留
    });

    // 进入 mine 页
    await mp.reLaunch('/pages/mine/mine');
    await new Promise(r => setTimeout(r, 1500));

    // mock 确认弹窗 + 捕获 toast
    await mp.mockWxMethod('showModal', { confirm: true });
    await mp.evaluate(() => {
      wx.__toastCalls = [];
      wx.showToast = (o) => { wx.__toastCalls.push(o.title); };
    });

    const page = await mp.currentPage();
    const cell = await page.$$('.cell');
    let btn = null;
    for (const c of cell) {
      const texts = await c.$$('text');
      for (const t of texts) {
        const txt = await t.text();
        if (txt && txt.indexOf('清除缓存') > -1) { btn = c; break; }
      }
      if (btn) break;
    }
    ok('找到「清除缓存」入口', !!btn);
    if (btn) {
      await btn.tap();
      await new Promise(r => setTimeout(r, 800));

      const state = await mp.evaluate(() => ({
        search: wx.getStorageSync('cm_search_history'),
        cat: wx.getStorageSync('cm_cat_filter'),
        pickupHist: wx.getStorageSync('cm_pickup_history'),
        logged: wx.getStorageSync('cm_logged'),
        emojis: wx.getStorageSync('cm_my_emojis'),
        toasts: wx.__toastCalls
      }));
      ok('搜索历史已清除', state.search === '' || state.search === undefined || state.search === null);
      ok('分类筛选缓存已清除', state.cat === '' || state.cat === undefined || state.cat === null);
      ok('自提点历史已清除', state.pickupHist === '' || state.pickupHist === undefined || state.pickupHist === null);
      ok('登录态 cm_logged 保留', state.logged === '1');
      ok('收藏表情 cm_my_emojis 保留', Array.isArray(state.emojis) && state.emojis[0] === '😀');
      ok('弹出「已清除」toast', (state.toasts || []).includes('已清除'));
    }

    await mp.disconnect();
    console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
