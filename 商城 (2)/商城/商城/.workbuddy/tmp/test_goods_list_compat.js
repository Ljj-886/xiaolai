// .workbuddy/tmp/test_goods_list_compat.js
// 单元测试：验证 goods.list 的 type 兼容逻辑（不依赖真实云函数，mock db）。
// 模拟历史数据（type=undefined / null / 'sell' / 'want'）的混合场景。

const cloud = { init() {}, callFunction() { return Promise.resolve({ result: { code: 0, data: { risky: false } } }); }, getTempFileURL() { return Promise.resolve({ fileList: [] }); }, uploadFile() { return Promise.resolve({ fileID: 'cloud://x' }); }, deleteFile() { return Promise.resolve() }, getWXContext() { return { OPENID: 'tester' }; } };
const dbData = {
  goods: [
    { _id: 'A', _openid: 'u1', title: '旧商品无 type 字段', price: 100, status: 'onSale', campus: '惠州经济职业技术学院', images: [], cover: '', condition: 'normal', createdAt: 1, viewCount: 0, favCount: 0 },
    { _id: 'B', _openid: 'u1', title: '旧商品 type=null', price: 100, status: 'onSale', campus: '惠州经济职业技术学院', images: [], cover: '', condition: 'normal', type: null, createdAt: 2, viewCount: 0, favCount: 0 },
    { _id: 'C', _openid: 'u1', title: '新商品 type=sell', price: 100, status: 'onSale', campus: '惠州经济职业技术学院', images: [], cover: '', condition: 'normal', type: 'sell', createdAt: 3, viewCount: 0, favCount: 0 },
    { _id: 'D', _openid: 'u1', title: '求购 type=want', price: 50, status: 'onSale', campus: '惠州经济职业技术学院', images: [], cover: '', condition: 'normal', type: 'want', createdAt: 4, viewCount: 0, favCount: 0 }
  ],
  users: [{ _openid: 'tester', school: '惠州经济职业技术学院', credit: 100 }],
  favorites: [], wants: []
};

// 极简 mock：支持 _.or([...]) / _.exists(false) / _.in([...])
class FakeQuery {
  constructor(rows) { this.rows = rows.slice(); }
  where(cond) {
    if (Array.isArray(cond) || (cond && cond.constructor && cond.constructor.name === 'OrObject')) {
      // _.and([where, _.or([...])]) 形态
      return new FakeQuery(this._applyAndOr(this.rows, cond));
    }
    return new FakeQuery(this._apply(this.rows, cond));
  }
  _apply(rows, c) {
    return rows.filter(r => Object.keys(c).every(k => {
      const v = c[k];
      if (v && v.__or) return v.list.some(x => this._match(r, x));
      if (v && v.__neq !== undefined) return r[k] !== v.__neq;
      if (v && v.__gte !== undefined) return r[k] >= v.__gte;
      if (v && v.__lte !== undefined) return r[k] <= v.__lte;
      if (typeof v === 'string' || typeof v === 'number') return r[k] === v;
      return true;
    }));
  }
  _applyAndOr(rows, conds) {
    return rows.filter(r => conds.every(c => Object.keys(c).every(k => {
      const v = c[k];
      if (v && v.__or) return v.list.some(x => this._match(r, x));
      if (typeof v === 'string' || typeof v === 'number') return r[k] === v;
      return true;
    })));
  }
  _match(r, sub) {
    return Object.keys(sub).every(k => {
      const v = sub[k];
      if (v && v.__exists === false) return r[k] === undefined;
      if (v && v.__in) return v.list.includes(r[k]);
      return r[k] === v;
    });
  }
  orderBy() { return this; }
  skip() { return this; }
  limit() { return this; }
  get() { return Promise.resolve({ data: this.rows }); }
}
const _ = {
  or(list) { return { __or: true, list }; },
  exists(b) { return { __exists: b }; },
  in(list) { return { __in: list }; },
  eq(v) { return v; }
};
const db = {
  _: _,
  collection(name) {
    const rows = dbData[name] || [];
    const q = new FakeQuery(rows);
    const obj = {
      where(c) { q.where(c); return obj; },
      field() { return obj; },
      orderBy() { return obj; }, skip() { return obj; }, limit() { return obj; },
      doc(id) {
        const row = rows.find(x => x._id === id) || null;
        return {
          get: async () => ({ data: row }),
          update: async () => ({}),
          remove: async () => ({})
        };
      },
      add: async () => ({ _id: 'new_' + Date.now() }),
      get: async () => ({ data: q.rows })
    };
    return obj;
  },
  command: _
};
const Module = require('module');
const _resolve = Module._resolveFilename;
const _load = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'wx-server-sdk') return { init: () => {}, database: () => db, getWXContext: () => ({ OPENID: 'tester' }), callFunction: cloud.callFunction, getTempFileURL: cloud.getTempFileURL, uploadFile: cloud.uploadFile, deleteFile: cloud.deleteFile, DYNAMIC_CURRENT_ENV: 'dev' };
  if (req === './sensitive-words.js') return { SENSITIVE_WORDS: [] };
  return _load.call(this, req, parent, ...rest);
};

const handler = require('../../cloudfunctions/goods/index.js');

(async () => {
  // 1. type=sell 应返回历史无 type 字段商品 (A, B) + 新 sell (C)，共 3 条，不含 D
  const r1 = await handler.main({ action: 'list', type: 'sell', page: 1, pageSize: 50 }, {});
  const ids1 = r1.data.list.map(x => x._id).sort();
  console.log('type=sell →', ids1.join(','));
  if (ids1.length !== 3 || ids1.includes('D')) { console.error('FAIL: type=sell 应包含 A/B/C 不含 D'); process.exit(1); }

  // 2. type=want 应只返回 D
  const r2 = await handler.main({ action: 'list', type: 'want', page: 1, pageSize: 50 }, {});
  const ids2 = r2.data.list.map(x => x._id);
  console.log('type=want →', ids2.join(','));
  if (ids2.length !== 1 || ids2[0] !== 'D') { console.error('FAIL: type=want 应只含 D'); process.exit(1); }

  // 3. 不传 type 应返回全部
  const r3 = await handler.main({ action: 'list', page: 1, pageSize: 50 }, {});
  const ids3 = r3.data.list.map(x => x._id).sort();
  console.log('type=undefined →', ids3.join(','));
  if (ids3.length !== 4) { console.error('FAIL: 不传 type 应返回 4 条'); process.exit(1); }

  console.log('✓ 3/3 通过：历史数据兼容正确');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });