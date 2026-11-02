// .workbuddy/tmp/test_cold_start.js
// 「冷启动 / 老库」全链路回归 —— 专门堵住这次线上事故那类坑。
//
// 背景：上一版 harness 用的是「集合都存在」的理想 mock，导致
//   wants 集合不存在 → 云函数 500 这种真实问题完全测不出来。
//
// 本测试严格模拟微信云开发的真实边界行为：
//   1. 查询「不存在的集合」→ .get() 异步 reject（不是返回空！）
//   2. 写入「不存在的集合」→ 自动创建并成功
//   3. 字段不存在的文档，普通等值查询匹配不到
//
// 场景 A：冷启动（新用户）—— 只有 users/goods，wants/favorites 都不存在
// 场景 B：老库历史数据 —— goods 里混着无 type 字段的旧商品

const Module = require('module');
const _load = Module._load;

function makeDB(initial) {
  // 只登记「已存在」的集合
  const cols = {};
  Object.keys(initial).forEach(k => { cols[k] = (initial[k] || []).slice(); });
  const autoId = () => 'id_' + Math.random().toString(36).slice(2, 10);

  const cmd = {
    or: l => ({ __or: l }),
    exists: b => ({ __exists: b }),
    in: l => ({ __in: l }),
    nin: l => ({ __nin: l }),
    neq: v => ({ __neq: v }),
    eq: v => v,
    gt: v => ({ __gt: v }),
    gte: v => ({ __gte: v }),
    lt: v => ({ __lt: v }),
    lte: v => ({ __lte: v }),
    inc: v => ({ __inc: v }),
    and: l => ({ __and: l })
  };

  // 判断单条文档是否匹配 where 条件（简化版，够本测试用）
  function match(row, cond) {
    return Object.keys(cond).every(k => {
      const v = cond[k];
      const rv = row[k];
      if (v && v.__or) return v.__or.some(sub => match(row, sub));
      if (v && v.__and) return v.__and.every(sub => match(row, sub));
      if (v && v.__exists !== undefined) return v.__exists ? rv !== undefined : rv === undefined;
      if (v && v.__in) return v.__in.indexOf(rv) !== -1;
      if (v && v.__nin) return v.__nin.indexOf(rv) === -1;
      if (v && v.__neq !== undefined) return rv !== v.__neq;
      if (v && v.__gt !== undefined) return rv > v.__gt;
      if (v && v.__gte !== undefined) return rv >= v.__gte;
      if (v && v.__lt !== undefined) return rv < v.__lt;
      if (v && v.__lte !== undefined) return rv <= v.__lte;
      return rv === v; // 等值：字段不存在自然不匹配
    });
  }

  function collection(name) {
    const exists = Object.prototype.hasOwnProperty.call(cols, name);
    // 不存在的集合：查询 reject，写入自动建
    if (!exists) {
      const reject = () => Promise.reject(new Error(`collection not exists: ${name}`));
      const chain = {
        where: () => chain,
        orderBy: () => chain,
        skip: () => chain,
        limit: () => chain,
        field: () => chain,
        get: reject,
        count: reject,
        doc: () => ({ get: reject, update: reject, remove: reject }),
        add: d => { cols[name] = [Object.assign({ _id: autoId() }, d && d.data)]; return Promise.resolve({ _id: cols[name][0]._id }); }
      };
      return chain;
    }
    // 注意：必须真正记录并应用 where 条件，否则过滤逻辑根本测不到（第一版就踩了这个坑）
    let rows = cols[name];
    let cond = null;
    const chain = {
      where: c => { cond = c; return chain; },
      orderBy: () => chain,
      skip: () => chain,
      limit: () => chain,
      field: () => chain,
      get: () => Promise.resolve({ data: cond ? rows.filter(r => match(r, cond)) : rows.slice() }),
      count: () => Promise.resolve({ total: cond ? rows.filter(r => match(r, cond)).length : rows.length }),
      doc: id => ({
        get: () => Promise.resolve({ data: rows.find(r => r._id === id) || null }),
        update: d => {
          const r = rows.find(x => x._id === id);
          if (r && d && d.data) {
            Object.keys(d.data).forEach(k => {
              if (d.data[k] && d.data[k].__inc !== undefined) r[k] = (r[k] || 0) + d.data[k].__inc;
              else r[k] = d.data[k];
            });
          }
          return Promise.resolve({});
        },
        remove: () => { rows = rows.filter(x => x._id !== id); cols[name] = rows; return Promise.resolve({}); }
      }),
      add: d => { const row = Object.assign({ _id: autoId() }, d && d.data); rows.push(row); return Promise.resolve({ _id: row._id }); }
    };
    return chain;
  }

  return { collection, command: cmd, _: cmd, _cols: cols };
}

// —— 场景 A：冷启动（新用户，wants/favorites 集合均不存在）——
const dbA = makeDB({
  users: [{ _id: 'u1', _openid: 'tester', school: '某大学', credit: 100, verified: true, nickName: '同学' }],
  goods: []
});

function installMock(db) {
  Module._load = function (req, parent, ...rest) {
    if (req === 'wx-server-sdk') {
      return {
        init: () => {},
        database: () => db,
        getWXContext: () => ({ OPENID: 'tester' }),
        callFunction: () => Promise.resolve({ result: { code: 0, data: { risky: false } } }),
        getTempFileURL: () => Promise.resolve({ fileList: [] }),
        uploadFile: () => Promise.resolve({ fileID: 'cloud://x' }),
        deleteFile: () => Promise.resolve({}),
        DYNAMIC_CURRENT_ENV: 'dev'
      };
    }
    if (req === './sensitive-words.js') return { SENSITIVE_WORDS: [] };
    return _load.call(this, req, parent, ...rest);
  };
}

let pass = 0, total = 0;
const t = (name, cond, extra) => {
  total++;
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { console.log(`❌ ${name}${extra ? ' → ' + extra : ''}`); }
};

(async () => {
  installMock(dbA);
  delete require.cache[require.resolve('../../cloudfunctions/goods/index.js')];
  delete require.cache[require.resolve('../../cloudfunctions/user/index.js')];
  const goods = require('../../cloudfunctions/goods/index.js');
  const user = require('../../cloudfunctions/user/index.js');

  console.log('—— 场景 A：冷启动（wants / favorites 集合都不存在）——');

  // A1 me（会触发 campus 同步，goods 为空）
  const m = await user.main({ action: 'me' }, {});
  t('me() 正常返回', m.code === 0, m.msg);

  // A2 发布出售商品
  const p1 = await goods.main({
    action: 'publish', title: '二手教材', desc: '几乎全新',
    images: ['cloud://a.jpg'], price: 20, category: 'book', type: 'sell'
  }, {});
  t('publish 出售成功', p1.code === 0, p1.msg);

  // A3 发布求购（无图）
  const p2 = await goods.main({
    action: 'publish', title: '求购自行车', desc: '', images: [], price: 100, category: 'other', type: 'want'
  }, {});
  t('publish 求购成功（不强制图）', p2.code === 0, p2.msg);

  // A4 首页列表（wants 不存在 → 绝不能 500）
  const l = await goods.main({ action: 'list', page: 1, pageSize: 20 }, {});
  t('list 不因 wants 缺失而 500', l.code === 0, l.msg);
  t('list 返回 2 件商品', l.code === 0 && l.data.list.length === 2, l.code === 0 ? `实际 ${l.data && l.data.list.length}` : l.msg);

  // A5 详情
  const d = await goods.main({ action: 'detail', id: p1.data && p1.data._id }, {});
  t('detail 不因 wants 缺失而 500', d.code === 0, d.msg);

  // A6 收藏（favorites 不存在 → 首次点击要成功）
  const f = await user.main({ action: 'toggleFav', goodsId: p1.data._id }, {});
  t('toggleFav 首次成功（自动建集合）', f.code === 0 && f.data && f.data.faved === true, f.msg);

  // A7 想要（wants 不存在 → 首次点击要成功）
  const w = await user.main({ action: 'toggleWant', goodsId: p1.data._id }, {});
  t('toggleWant 首次成功（自动建集合）', w.code === 0 && w.data && w.data.wanted === true, w.msg);

  // A8 建了集合之后再 list，wanted/faved 应正确读回
  const l2 = await goods.main({ action: 'list', page: 1, pageSize: 20 }, {});
  const hit = l2.code === 0 && l2.data.list.find(x => x._id === p1.data._id);
  t('集合创建后 faved 读回 true', !!(hit && hit.faved), hit ? `faved=${hit.faved}` : 'n/a');
  t('集合创建后 wanted 读回 true', !!(hit && hit.wanted), hit ? `wanted=${hit.wanted}` : 'n/a');

  // A9 我的商品（type 过滤兼容）
  const mg = await user.main({ action: 'myGoods', page: 1, pageSize: 20 }, {});
  t('myGoods 正常返回', mg.code === 0, mg.msg);
  t('myGoods 返回 2 件', mg.code === 0 && mg.data.list.length === 2, mg.code === 0 ? `实际 ${mg.data.list.length}` : mg.msg);

  // A10 我的收藏（集合已建）
  const mf = await user.main({ action: 'myFavs', page: 1, pageSize: 20 }, {});
  t('myFavs 正常返回', mf.code === 0, mf.msg);

  // —— 场景 B：老库（goods 里混着无 type 字段的旧商品，且 wants/favorites 缺失）——
  console.log('\n—— 场景 B：老库历史数据（商品无 type 字段）——');
  const dbB = makeDB({
    users: [{ _id: 'u1', _openid: 'tester', school: '某大学', credit: 100, verified: true, nickName: '同学' }],
    goods: [
      { _id: 'OLD1', _openid: 'tester', title: '旧商品无type', price: 30, status: 'onSale', campus: '某大学', images: [], cover: '', createdAt: 1 },
      { _id: 'OLD2', _openid: 'tester', title: '旧商品type=null', price: 40, status: 'onSale', campus: '某大学', images: [], cover: '', type: null, createdAt: 2 },
      { _id: 'NEW1', _openid: 'tester', title: '新出售', price: 50, status: 'onSale', campus: '某大学', images: [], cover: '', type: 'sell', createdAt: 3 },
      { _id: 'NEW2', _openid: 'tester', title: '新求购', price: 60, status: 'onSale', campus: '某大学', images: [], cover: '', type: 'want', createdAt: 4 }
    ]
  });
  installMock(dbB);
  delete require.cache[require.resolve('../../cloudfunctions/goods/index.js')];
  delete require.cache[require.resolve('../../cloudfunctions/user/index.js')];
  const goodsB = require('../../cloudfunctions/goods/index.js');
  const userB = require('../../cloudfunctions/user/index.js');

  const bSell = await goodsB.main({ action: 'list', type: 'sell', page: 1, pageSize: 50 }, {});
  const idsSell = bSell.code === 0 ? bSell.data.list.map(x => x._id).sort() : [];
  t('type=sell 含历史无 type 商品', bSell.code === 0 && idsSell.length === 3 && !idsSell.includes('NEW2'),
    bSell.code === 0 ? `得到 ${idsSell.join(',')}` : bSell.msg);

  const bWant = await goodsB.main({ action: 'list', type: 'want', page: 1, pageSize: 50 }, {});
  const idsWant = bWant.code === 0 ? bWant.data.list.map(x => x._id) : [];
  t('type=want 只返回求购', bWant.code === 0 && idsWant.length === 1 && idsWant[0] === 'NEW2',
    bWant.code === 0 ? `得到 ${idsWant.join(',')}` : bWant.msg);

  const bAll = await goodsB.main({ action: 'list', page: 1, pageSize: 50 }, {});
  t('不传 type 返回全部 4 件', bAll.code === 0 && bAll.data.list.length === 4,
    bAll.code === 0 ? `实际 ${bAll.data.list.length}` : bAll.msg);

  const bMine = await userB.main({ action: 'myGoods', type: 'sell', page: 1, pageSize: 50 }, {});
  t('myGoods type=sell 兼容历史数据', bMine.code === 0 && bMine.data.list.length === 3,
    bMine.code === 0 ? `实际 ${bMine.data.list.length}` : bMine.msg);

  console.log(`\n=== ${pass}/${total} 通过 ===`);
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error('测试异常', e); process.exit(1); });