/**
 * 验证本轮云函数改动：
 *  1. order.detail / chat.convs / goods.decorate / user.myFavs 的 field 投影包含 school
 *  2. 用户记录缺失时 buyerInfo/sellerInfo/peerInfo/sellerInfo 返回 {} 而非 undefined（防前端崩溃）
 *  3. user.reviewVerify 通过时清空上一次驳回理由
 */
const Module = require('module');
const path = require('path');
const origLoad = Module._load;

const STORE = {
  users: [
    { _id: 'u1', _openid: 'b1', nickName: '买家', school: '惠州经济职业技术学院', verified: true, credit: 90, avatarUrl: 'a',
      realName: '张三', studentId: '20230101', status: 'normal', verifyApply: { status: 'pending', school: '惠州经济职业技术学院', reason: '上次驳回理由' } },
    { _id: 'u2', _openid: 's1', nickName: '卖家', school: '惠州经济职业技术学院', verified: true, credit: 80, avatarUrl: 'b' }
  ],
  orders: { o1: { _id: 'o1', buyerId: 'b1', sellerId: 's1', status: 'pending', goodsId: 'g1', goodsSnapshot: { cover: 'cloud://c1' } } },
  conversations: [{ _id: 'c1', participants: ['b1', 's1'], lastMessageAt: 1, unread: {} }],
  goods: [{ _id: 'g1', _openid: 's1', title: '书', cover: 'cloud://c1', images: [], status: 'onSale', campus: '惠州经济职业技术学院' }],
  favorites: [{ _id: 'f1', _openid: 'b1', goodsId: 'g1', createdAt: 1 }],
  reviews: [], reports: []
};

let lastField = null;

function project(doc, field) {
  if (!field) return { ...doc };
  const out = {};
  Object.keys(field).forEach(k => { if (field[k] && k in doc) out[k] = doc[k]; });
  return out;
}

function matchOne(r, k, v) {
  const actual = r[k];
  if (v && typeof v === 'object') {
    if (v.__in) return v.__in.includes(actual);
    if (v.__nin) return !v.__nin.includes(actual);
    if ('__neq' in v) return actual !== v.__neq;
    if ('__exists' in v) return (actual !== undefined) === !!v.__exists;
    if (v.__or) return v.__or.some(sub => matchCond(r, sub));
    if (v.__and) return v.__and.every(sub => matchCond(r, sub));
    return true;
  }
  // 数组字段：participants 这种「包含」语义
  if (Array.isArray(actual)) return actual.includes(v);
  if (Array.isArray(v)) return v.includes(actual);
  return actual === v;
}
function matchCond(r, c) {
  return Object.keys(c || {}).every(k => matchOne(r, k, c[k]));
}

function makeQuery(name) {
  const q = {
    _cond: null, _field: null, _limit: null, _order: null,
    where(c) { this._cond = c; return this; },
    field(f) { this._field = f; lastField = f; return this; },
    orderBy(k, d) { this._order = [k, d]; return this; },
    limit(n) { this._limit = n; return this; },
    skip() { return this; },
    async get() {
      let rows = (STORE[name] && STORE[name].data) || (Array.isArray(STORE[name]) ? STORE[name] : []);
      const c = this._cond || {};
      rows = rows.filter(r => matchCond(r, c));
      if (this._order) rows = [...rows].sort((a, b) => (b[this._order[0]] || 0) - (a[this._order[0]] || 0));
      if (this._limit) rows = rows.slice(0, this._limit);
      return { data: rows.map(r => project(r, this._field)) };
    },
    async count() { const r = await this.get(); return { total: r.data.length }; },
    async update() { return { stats: { updated: 1 } }; },
    async remove() { return { stats: { removed: 1 } }; }
  };
  return q;
}

const db = {
  collection(name) {
    return {
      doc(id) {
        return {
          async get() {
            const src = Array.isArray(STORE[name]) ? STORE[name].find(x => x._id === id) : (STORE[name] || {})[id];
            return { data: src ? { ...src } : null };
          },
          async update({ data }) {
            const target = Array.isArray(STORE[name]) ? STORE[name].find(x => x._id === id) : (STORE[name] || {})[id];
            if (target) Object.assign(target, data);
            UPDATES.push({ name, id, data });
            return { stats: { updated: 1 } };
          },
          async remove() { return { stats: { removed: 1 } }; }
        };
      },
      where(c) { return makeQuery(name).where(c); },
      async add({ data }) { STORE[name].push(data); return { _id: 'new' }; },
      async count() { return { total: (STORE[name] || []).length }; },
      async get() { return { data: STORE[name] || [] }; }
    };
  },
  get command() { return _; }, // 惰性，避免 _ 尚未初始化（TDZ）
  serverDate() { return Date.now(); },
  RegExp: function () { return {}; }
};
const UPDATES = [];
const _ = {
  in: arr => ({ __in: arr }),
  nin: arr => ({ __nin: arr }),
  neq: v => ({ __neq: v }),
  exists: v => ({ __exists: v }),
  or: arr => ({ __or: arr }),
  and: arr => ({ __and: arr }),
  inc: n => ({ __inc: n }),
  set: v => ({ __set: v }),
  remove: () => ({ __remove: true }),
  push: v => ({ __push: v })
};
const cloud = {
  DYNAMIC_CURRENT_ENV: 'env',
  database: () => db,
  getWXContext: () => ({ OPENID: 'b1' }),
  async getTempFileURL({ fileList = [] }) { return { fileList: fileList.map(f => ({ fileID: f, tempFileURL: 'https://x/' + f, status: 0 })) }; },
  openapi: {}
};

const mockSdk = {
  init() {},
  db,
  cloud,
  database: () => db,
  getWXContext: cloud.getWXContext,
  async getTempFileURL({ fileList = [] }) {
    return { fileList: fileList.map(f => ({ fileID: f, tempFileURL: 'https://x/' + f, status: 0 })) };
  },
  DYNAMIC_CURRENT_ENV: 'env'
};

Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockSdk;
  return origLoad.apply(this, arguments);
};

let pass = 0, failn = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failn++; console.log('  ✗ ' + name); }
}

(async () => {
  const order = require(path.resolve('cloudfunctions/order/index.js'));
  const chat = require(path.resolve('cloudfunctions/chat/index.js'));
  const goods = require(path.resolve('cloudfunctions/goods/index.js'));
  const user = require(path.resolve('cloudfunctions/user/index.js'));

  console.log('\n[1] order.detail — 双方信息含 school，且缺失时返回 {}');
  const od = await order.main({ action: 'detail', orderId: 'o1' });
  check('code=0', od.code === 0);
  check('buyerInfo.school 有值', od.data.buyerInfo.school === '惠州经济职业技术学院');
  check('sellerInfo.school 有值', od.data.sellerInfo.school === '惠州经济职业技术学院');
  check('field 投影含 school', lastField && lastField.school === true);
  check('不泄漏 realName', od.data.buyerInfo.realName === undefined);
  check('不泄漏 studentId', od.data.buyerInfo.studentId === undefined);

  // 用户记录缺失 → 应返回 {} 而不是 undefined
  const savedUsers = STORE.users;
  STORE.users = [];
  const od2 = await order.main({ action: 'detail', orderId: 'o1' });
  check('用户缺失时 buyerInfo={}', od2.code === 0 && od2.data.buyerInfo && typeof od2.data.buyerInfo === 'object');
  check('用户缺失时 sellerInfo={}', od2.code === 0 && od2.data.sellerInfo && typeof od2.data.sellerInfo === 'object');
  STORE.users = savedUsers;

  console.log('\n[2] chat.convs — peerInfo 含 school + credit，缺失返回 {}');
  const cv = await chat.main({ action: 'convs' });
  check('code=0', cv.code === 0);
  check('peerInfo.school 有值', cv.data.list[0].peerInfo.school === '惠州经济职业技术学院');
  check('peerInfo.credit 有值', cv.data.list[0].peerInfo.credit === 80);
  check('field 投影含 school', lastField && lastField.school === true);
  STORE.users = [];
  const cv2 = await chat.main({ action: 'convs' });
  check('用户缺失时 peerInfo={}', cv2.code === 0 && cv2.data.list[0].peerInfo && typeof cv2.data.list[0].peerInfo === 'object');
  STORE.users = savedUsers;

  console.log('\n[3] goods.list — sellerInfo 含 school');
  const gl = await goods.main({ action: 'list', page: 1, pageSize: 20 });
  check('code=0', gl.code === 0);
  const g0 = (gl.data.list || [])[0];
  check('sellerInfo.school 有值', !!g0 && g0.sellerInfo.school === '惠州经济职业技术学院');
  check('sellerInfo 不为 null', !!g0 && g0.sellerInfo !== null);

  console.log('\n[4] user.myFavs — 走 decorate（含 sellerInfo + https 封面）');
  const mf = await user.main({ action: 'myFavs', page: 1, pageSize: 20 });
  check('code=0', mf.code === 0);
  const f0 = (mf.data.list || [])[0];
  check('收藏项有 sellerInfo', !!f0 && !!f0.sellerInfo);
  check('收藏项封面转 https', !!f0 && String(f0.cover).startsWith('https://'));

  console.log('\n[5] user.reviewVerify — 通过时清空上次驳回理由 + 同步 goods.campus');
  // 需要管理员身份：mock 的 OPENID 是 b1，先在 users 里把 b1 标记为 admin
  STORE.users[0].isAdmin = true;
  const rv = await user.main({ action: 'reviewVerify', targetOpenid: 'b1', pass: true });
  check('code=0', rv.code === 0);
  const applyUpdate = UPDATES.filter(u => u.name === 'users' && u.id === 'u1').pop();
  check('verifyApply.reason 被清空', applyUpdate && applyUpdate.data['verifyApply.reason'] === '');
  check('verified=true', applyUpdate && applyUpdate.data.verified === true);
  check('users.school 同步', applyUpdate && applyUpdate.data.school === '惠州经济职业技术学院');

  console.log('\n=== 合计: ' + pass + ' 通过 / ' + failn + ' 失败 ===');
  process.exit(failn ? 1 : 0);
})();
