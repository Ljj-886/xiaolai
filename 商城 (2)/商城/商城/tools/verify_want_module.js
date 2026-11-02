// tools/verify_want_module.js —— 求购模块专项验证
// 覆盖：发布求购 → 详情数据 → 列表分类 → 状态文案 → 下单拦截 → 自清理
// 只创建 1 条测试求购并删除，不动真实数据。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function assert(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra === undefined ? '' : String(extra).slice(0, 220) });
}

function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    const callFn = async (name, data) => evalSafe(mp, (n, d) => {
      return wx.cloud.callFunction({ name: n, data: d })
        .then(r => r.result)
        .catch(e => ({ __callErr: String((e && (e.errMsg || e.message)) || e) }));
    }, name, data);

    // ---------- 0) 环境前提：要有学校 ----------
    const me = await callFn('user', { action: 'me' });
    const md = me && me.data;
    assert('取到当前用户', !!md, JSON.stringify(me).slice(0, 160));
    assert('当前用户已选学校（否则求购发不出）', !!(md && md.school), 'school=' + (md && md.school));

    let wantId = '';

    // ---------- 1) 无图发布求购（核心：求购允许无图） ----------
    const pub = await callFn('goods', {
      action: 'publish',
      title: '求购验证-自行车',
      desc: '求购一辆二手自行车，预算 200 左右，成色无所谓',
      images: [],
      price: '200',
      category: 'sports',
      type: 'want'
    });
    wantId = pub && pub.data && pub.data._id;
    assert('求购可无图发布成功', !!wantId, JSON.stringify(pub).slice(0, 200));

    // ---------- 2) 服务端落库字段 ----------
    if (wantId) {
      const d = await callFn('goods', { action: 'detail', id: wantId });
      const g = d && d.data;
      assert('求购详情可读', !!g, JSON.stringify(d).slice(0, 160));
      assert('type=want', g && g.type === 'want', g && g.type);
      assert('求购 condition 被规范为 normal', g && g.condition === 'normal', g && g.condition);
      assert('求购 images 为空数组', g && Array.isArray(g.images) && g.images.length === 0, g && JSON.stringify(g.images));
      assert('求购 price=200 作为预算', g && Number(g.price) === 200, g && g.price);
      assert('求购 originalPrice 被清空', g && (g.originalPrice === null || g.originalPrice === undefined), g && g.originalPrice);
      assert('求购初始 status=pending', g && g.status === 'pending', g && g.status);
      assert('求购 imgCheckStatus=safe（无图不触发图片安检）', g && g.imgCheckStatus === 'safe', g && g.imgCheckStatus);
    }

    // ---------- 3) 列表按 type 分流 ----------
    const lw = await callFn('goods', { action: 'list', type: 'want', status: 'onSale', pageSize: 5 });
    const lwd = lw && lw.data;
    assert('求购列表接口可调用', !!(lwd && Array.isArray(lwd.list)), JSON.stringify(lw).slice(0, 160));
    const lwBad = (lwd && lwd.list || []).filter(x => x.type !== 'want');
    assert('求购列表严格只含 want', lwBad.length === 0, '异常项=' + lwBad.length);
    const ls = await callFn('goods', { action: 'list', type: 'sell', status: 'onSale', pageSize: 10 });
    const lsBad = ((ls && ls.data && ls.data.list) || []).filter(x => x.type === 'want');
    assert('出售列表不含 want', lsBad.length === 0, '异常项=' + lsBad.length);

    // ---------- 4) 求购不应被下单（服务端拦截） ----------
    // 先让求购变成 onSale（管理员通过审核），再尝试下单
    if (wantId) {
      const rv = await callFn('admin', { action: 'reviewGoods', id: wantId, pass: true });
      assert('管理员可通过求购审核', rv && rv.code === 0, JSON.stringify(rv).slice(0, 160));

      const ord = await callFn('order', {
        action: 'create', goodsId: wantId,
        meetingTime: '2026-09-16 12:00', meetingPlace: '图书馆门口', message: '测试'
      });
      // 期望：被拦截（不能对求购下单）。若成功创建 → 说明存在漏洞
      const blocked = !(ord && ord.code === 0);
      assert('【漏洞检查】求购不可被下单', blocked, blocked ? ('已拦截: ' + (ord && ord.msg)) : ('未拦截！订单已创建: ' + JSON.stringify(ord).slice(0, 160)));

      // 若真的创建成功了，清理掉这个订单
      const oid = ord && ord.data && (ord.data._id || ord.data.orderNo);
      if (!blocked && oid) {
        await callFn('order', { action: 'cancel', id: (ord.data._id || oid), reason: '测试清理' });
        results.push({ name: '（清理）测试订单已尝试取消', ok: true, extra: String(oid) });
      }
    }

    // ---------- 5) 图片为空时的详情页渲染 ----------
    if (wantId) {
      await mp.reLaunch('/pages/detail/detail?id=' + wantId);
      await wait(3000);
      const info = await evalSafe(mp, () => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        const d = p && p.data || {};
        return {
          route: p && p.route,
          hasItem: !!d.item,
          type: d.item && d.item.type,
          imagesLen: d.item && d.item.images ? d.item.images.length : -1,
          swiperCurrent: d.swiperCurrent,
          condText: d.condText,
          isOwner: d.isOwner
        };
      });
      console.log('  detail page data:', JSON.stringify(info));
      assert('详情页路由正确', info && info.route === 'pages/detail/detail', JSON.stringify(info).slice(0, 200));
      assert('详情页拿到求购数据', info && info.hasItem && info.type === 'want', JSON.stringify(info).slice(0, 200));
      assert('【问题定位】无图求购图片数为 0（计数器会显示 1/0）', info && info.imagesLen === 0, 'imagesLen=' + (info && info.imagesLen));
      assert('【问题定位】无图求购仍渲染成色文案「正常使用」', info && info.condText === '正常使用', 'condText=' + (info && info.condText));

      const el = await mp.evaluate(() => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        return p ? (p.__route__ || p.route) : '';
      }).catch(() => '');
      console.log('  current route:', el);
    }

    // ---------- 6) 清理：删除测试求购 ----------
    if (wantId) {
      const del = await callFn('goods', { action: 'remove', id: wantId });
      assert('（清理）测试求购已删除', del && del.code === 0, JSON.stringify(del).slice(0, 160));
    }

  } catch (e) {
    assert('脚本整体执行', false, String((e && e.message) || e));
  }

  // ---------- 输出 ----------
  console.log('\n======== 求购模块验证结果 ========');
  let pass = 0;
  results.forEach(r => {
    console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
    if (r.ok) pass++;
  });
  console.log('--------------------------------');
  console.log(`  通过 ${pass}/${results.length}`);
  process.exit(0);
})();
