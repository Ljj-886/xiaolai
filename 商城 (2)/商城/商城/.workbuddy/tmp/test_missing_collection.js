// .workbuddy/tmp/test_missing_collection.js
// 验证：wants / favorites 集合「不存在」时，云函数不能崩，必须降级返回。
// 这是本次线上事故的根因回归测试：查询不存在的集合会抛 collection not exists。

const Module = require('module');
const _load = Module._load;

// 模拟一个「集合不存在就抛错」的数据库（贴近云开发真实行为）
const EXISTING = ['goods', 'users']; // wants / favorites 均不存在
function makeDb() {
  const cmd = {
    or: l => ({ __or: true, list: l }),
    exists: b => ({ __exists: b }),
    in: l => ({ __in: true, list: l }),
    neq: v => ({ __neq: v }),
    gte: v => ({ __gte: v }),
    lte: v => ({ __lte: v }),
    inc: v => ({ __inc: v })
  };
  const data = {
    goods: [
      { _id: 'G1', _openid: 'u1', title: '旧商品', price: 10, status: 'onSale', campus: '某校', images: [], cover: '', createdAt: 1 },
      { _id: 'G2', _openid: 'u1', title: '求购', price: 5, status: 'onSale', campus: '某校', images: [], cover: '', type: 'want', createdAt: 2 }
    ],
    users: [{ _openid: 'tester', school: '某校', credit: 100, verified: true, nickName: '测试' }]
  };
  function collection(name) {
    if (!EXISTING.includes(name)) {
      // 未创建的集合真实行为：
      //   查询 (where/get) → 抛 collection not exists
      //   写入 (add)      → 云开发自动创建集合并成功
      const boom = () => Promise.reject(new Error(`collection not exists: ${name}`));
      return {
        where: boom, doc: boom, count: boom, get: boom,
        add: () => Promise.resolve({ _id: 'new_' + Date.now() }),
        orderBy() { return this; }, skip() { return this; }, limit() { return this; }, field() { return this; }
      };
    }
    const rows = data[name] || [];
    const o = {
      where(c) { return o; },
      field() { return o; },
      orderBy() { return o; }, skip() { return o; }, limit() { return o; },
      get: () => Promise.resolve({ data: rows.slice() }),
      doc: id => ({ get: () => Promise.resolve({ data: rows.find(r => r._id === id) || null }), update: () => Promise.resolve({}), remove: () => Promise.resolve({}) }),
      add: () => Promise.resolve({ _id: 'new' }),
      count: () => Promise.resolve({ total: rows.length })
    };
    return o;
  }
  return { collection, command: cmd, _: cmd };
}
const db = makeDb();
const deleted = [];
Module._load = function (req, parent, ...rest) {
  if (req === 'wx-server-sdk') {
    return {
      init: () => {},
      database: () => db,
      getWXContext: () => ({ OPENID: 'tester' }),
      callFunction: () => Promise.resolve({ result: { code: 0, data: { risky: false } } }),
      getTempFileURL: () => Promise.resolve({ fileList: [] }),
      uploadFile: () => Promise.resolve({ fileID: 'cloud://x' }),
      deleteFile: f => { deleted.push(f); return Promise.resolve({}); },
      DYNAMIC_CURRENT_ENV: 'dev'
    };
  }
  if (req === './sensitive-words.js') return { SENSITIVE_WORDS: [] };
  return _load.call(this, req, parent, ...rest);
};

const goods = require('../../cloudfunctions/goods/index.js');
const user = require('../../cloudfunctions/user/index.js');

(async () => {
  let pass = 0, total = 0;
  const t = (name, cond) => { total++; if (cond) { pass++; console.log(`✅ ${name}`); } else { console.log(`❌ ${name}`); } };

  // 1. goods.list 在 wants 集合不存在时必须成功返回（不能 500）
  const r1 = await goods.main({ action: 'list', page: 1, pageSize: 20 }, {});
  t('goods.list 不因 wants 缺失而崩溃', r1.code === 0);
  t('goods.list 返回商品', r1.code === 0 && r1.data.list.length > 0);
  t('wanted 标记降级为 false', r1.code === 0 && r1.data.list.every(x => x.wanted === false));

  // 2. goods.detail 同理
  const r2 = await goods.main({ action: 'detail', id: 'G1' }, {});
  t('goods.detail 不因 wants 缺失而崩溃', r2.code === 0);

  // 3. user.toggleWant 首次点击（集合不存在）必须能成功写入
  const r3 = await user.main({ action: 'toggleWant', goodsId: 'G1' }, {});
  t('toggleWant 首次点击成功（自动建集合）', r3.code === 0 && r3.data && r3.data.wanted === true);

  // 4. user.toggleFav 同理（favorites 也不存在）
  const r4 = await user.main({ action: 'toggleFav', goodsId: 'G1' }, {});
  t('toggleFav 首次点击成功（自动建集合）', r4.code === 0 && r4.data && r4.data.faved === true);

  // 5. user.myFavs 集合不存在时返回空列表而非 500
  const r5 = await user.main({ action: 'myFavs', page: 1, pageSize: 20 }, {});
  t('myFavs 集合缺失时返回空列表', r5.code === 0 && Array.isArray(r5.data.list) && r5.data.list.length === 0);

  console.log(`\n=== ${pass}/${total} 通过 ===`);
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error('测试异常', e); process.exit(1); });