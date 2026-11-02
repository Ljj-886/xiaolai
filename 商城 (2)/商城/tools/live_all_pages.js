// tools/live_all_pages.js
// 真机遍历全部页面，检查是否报错。
//
// 设计要点（踩过坑）：
//   - IDE 长时间高频 reLaunch 会崩 → 必须「分批 + 每批重连」
//   - 单页卡死会拖垮整轮 → 每页加超时保护
//   - 需要参数的页面自动从列表页抓真实 id
//
// 用法：npm run live:all

const automator = require('miniprogram-automator');

const TAB_PAGES = new Set([
  '/pages/index/index',
  '/pages/category/category',
  '/pages/publish/publish',
  '/pages/chat/chat',
  '/pages/mine/mine'
]);
const ERR_FIELDS = ['loadError', 'errMsg', 'error', 'errorMsg', 'loadFail'];
// 支持断点续跑：node tools/live_all_pages.js <起始索引> <本轮页数>
// IDE 在自动化下不稳，崩了就从上次的位置继续，不用重头跑
  const START = parseInt(process.argv[2] || '0', 10);
  const COUNT = parseInt(process.argv[3] || '999', 10);
const BATCH = 3;          // 每批页面数（IDE 高频 reLaunch 易崩，必须小批量）
const PAGE_TIMEOUT = 9000; // 单页超时

function fmtErr(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.msg || v.message || v.errMsg || JSON.stringify(v).slice(0, 120);
  return String(v);
}

async function connect() {
  return await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
}

(async () => {
  // 上下文：直接用已知 id（IDE 极不稳定，多一次页面切换就多一次崩溃风险）
  // 如需更新 id，启动时传第 4、5 个参数
  let goodsId = process.argv[4] || 'e04f59456a9f771102dc84722888f359';
  let orderId = process.argv[5] || '10b550da6a9c13d701890e973743368b';
  console.log(`上下文：goodsId=${goodsId || '无'} | orderId=${orderId || '无'}\n`);

  const PAGES = [
    { path: '/pages/index/index', label: '首页' },
    { path: '/pages/category/category', label: '分类' },
    { path: '/pages/publish/publish', label: '发布' },
    { path: '/pages/chat/chat', label: '消息' },
    { path: '/pages/mine/mine', label: '我的' },
    { path: '/pages/search/search', label: '搜索' },
    { path: '/pages/sold/sold?status=onSale', label: '我的商品' },
    { path: '/pages/favorite/favorite', label: '我的收藏' },
    { path: '/pages/credit/credit', label: '信用分' },
    { path: '/pages/pickup/pickup', label: '自提点' },
    { path: '/pages/edit-profile/edit-profile', label: '编辑资料' },
    { path: '/pages/verify/verify', label: '学生认证' },
    { path: '/pages/login/login', label: '登录' },
    { path: '/pages/agreement/agreement', label: '用户协议' },
    { path: '/pages/privacy/privacy', label: '隐私政策' },
    { path: '/pages/feedback/feedback', label: '意见反馈' },
    { path: '/pages/order/order', label: '我的订单' },
    { path: '/pages/admin/admin', label: '管理后台' },
    { path: '/pages/admin-goods/admin-goods', label: '商品管理' },
    { path: '/pages/admin-users/admin-users', label: '用户管理' },
    { path: '/pages/admin-reviews/admin-reviews', label: '审核中心' },
    { path: goodsId ? `/pages/detail/detail?id=${goodsId}` : null, label: '商品详情' },
    { path: orderId ? `/pages/order-detail/order-detail?id=${orderId}` : null, label: '订单详情' },
    { path: orderId ? `/pages/review/review?orderId=${orderId}` : null, label: '评价' },
    { path: goodsId ? `/pages/report/report?targetType=goods&targetId=${goodsId}` : null, label: '举报' }
  ];

  const todo = PAGES.slice(START, START + COUNT);
  const results = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let mp2 = null;
    try { mp2 = await connect(); } catch (e) {
      batch.forEach(p => results.push({ label: p.label, ok: false, note: '连不上IDE' }));
      console.log(`❌ 批次 ${i / BATCH + 1} 连不上 IDE`);
      continue;
    }
    for (const p of batch) {
      if (!p.path) {
        results.push({ label: p.label, ok: null, note: '跳过（缺 id）' });
        console.log(`⏭️  ${p.label.padEnd(10)} 跳过（缺 id）`);
        continue;
      }
      let ok = true, note = '';
      try {
        const job = async () => {
          const base = p.path.split('?')[0];
          if (TAB_PAGES.has(base)) await mp2.switchTab(base);
          else await mp2.reLaunch(p.path);
          await new Promise(r => setTimeout(r, 2000));
          const pg = await mp2.currentPage();
          return await pg.data();
        };
        const d = await Promise.race([
          job(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('单页超时')), PAGE_TIMEOUT))
        ]);
        for (const f of ERR_FIELDS) {
          const v = fmtErr(d[f]);
          if (v) { ok = false; note = `${f}=${v.slice(0, 100)}`; break; }
        }
      } catch (e) {
        ok = false; note = e.message.slice(0, 100);
      }
      results.push({ label: p.label, ok, note });
      console.log(`${ok ? '✅' : '❌'} ${p.label.padEnd(10)} ${note || '正常'}`);
    }
    // 注意：不要 close！实测 mp.close() 会让 IDE 退出/端口断开，
    // 导致下一批连不上。批间只做短暂停顿。
    await new Promise(r => setTimeout(r, 800)); // 批间喘息
  }

  console.log(`\n（检查范围：第 ${START + 1} ~ ${START + todo.length} 页，共 ${todo.length}）`);
  const failed = results.filter(r => r.ok === false);
  const skipped = results.filter(r => r.ok === null);
  const good = results.filter(r => r.ok === true);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`总计 ${results.length} | ✅ ${good.length} | ❌ ${failed.length} | ⏭️ ${skipped.length}`);
  if (failed.length) {
    console.log('\n失败明细：');
    failed.forEach(f => console.log(`  ❌ ${f.label}: ${f.note}`));
  }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('❌ 脚本异常', e.message); process.exit(1); });