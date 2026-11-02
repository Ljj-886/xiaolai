/**
 * 验证本轮合规改动：
 *  1. applyVerify 未明示同意 → 拒绝（服务端兜底，不能只靠前端）
 *  2. applyVerify 已同意 → 写入 agreed / agreedAt 留痕
 *  3. reviewVerify 通过 → 清空 evidence 字段 + 真删云存储图片（兑现隐私政策 2.3）
 *  4. reviewVerify 驳回 → 保留 evidence、不删图片（用户要看驳回原因并重传）
 */
const Module = require('module');
const path = require('path');
const origLoad = Module._load;

const STORE = {
  users: [{
    _id: 'u1', _openid: 'b1', nickName: '同学', isAdmin: true, verified: false,
    status: 'normal', credit: 100,
    verifyApply: {
      status: 'pending', realName: '张三', studentId: '20230101',
      school: '惠州经济职业技术学院', education: '本科',
      evidence: ['cloud://e1.png', 'cloud://e2.png'],
      createdAt: Date.now()
    }
  }],
  goods: [], orders: {}, favorites: [], conversations: [], reviews: [], reports: []
};

let DELETED = [];

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
    if ('__neq' in v) return actual !== v.__neq;
    if ('__exists' in v) return (actual !== undefined) === !!v.__exists;
    if ('__lt' in v) return actual < v.__lt;
    if (v.__or) return v.__or.some(sub => matchCond(r, sub));
    return true;
  }
  if (Array.isArray(actual)) return actual.includes(v);
  return actual === v;
}
function matchCond(r, c) {
  return Object.keys(c || {}).every(k => matchOne(r, k, c[k]));
}
function makeQuery(name) {
  const q = {
    _cond: null, _field: null, _limit: null, _update: null,
    where(c) { this._cond = c; return this; },
    field(f) { this._field = f; return this; },
    limit(n) { this._limit = n; return this; },
    skip() { return this; },
    orderBy() { return this; },
    async get() {
      let rows = Array.isArray(STORE[name]) ? STORE[name] : [];
      rows = rows.filter(r => matchCond(r, this._cond || {}));
      if (this._limit) rows = rows.slice(0, this._limit);
      return { data: rows.map(r => project(r, this._field)) };
    },
    async update({ data }) {
      let rows = Array.isArray(STORE[name]) ? STORE[name] : [];
      rows = rows.filter(r => matchCond(r, this._cond || {}));
      rows.forEach(r => {
        Object.keys(data).forEach(k => {
          if (k.indexOf('.') > 0) {
            const [a, b] = k.split('.');
            r[a] = r[a] || {};
            r[a][b] = data[k];
          } else r[k] = data[k];
        });
      });
      return { stats: { updated: rows.length } };
    },
    async count() { const r = await this.get(); return { total: r.data.length }; }
  };
  return q;
}
const db = {
  collection(name) {
    return {
      doc(id) {
        return {
          async get() {
            const src = (Array.isArray(STORE[name]) ? STORE[name] : []).find(x => x._id === id);
            return { data: src ? { ...src } : null };
          },
          async update({ data }) {
            const t = (Array.isArray(STORE[name]) ? STORE[name] : []).find(x => x._id === id);
            if (t) {
              // 支持点号路径（真实云数据库行为），否则 'verifyApply.evidence' 会被当成字面量键
              Object.keys(data).forEach(k => {
                if (k.indexOf('.') > 0) {
                  const seg = k.split('.');
                  let cur = t;
                  for (let i = 0; i < seg.length - 1; i++) {
                    cur[seg[i]] = cur[seg[i]] || {};
                    cur = cur[seg[i]];
                  }
                  cur[seg[seg.length - 1]] = data[k];
                } else t[k] = data[k];
              });
            }
            return { stats: { updated: 1 } };
          }
        };
      },
      where(c) { return makeQuery(name).where(c); },
      async add({ data }) { STORE[name].push(data); return { _id: 'new' }; },
      async count() { return { total: (STORE[name] || []).length }; },
      async get() { return { data: STORE[name] || [] }; }
    };
  },
  get command() { return _; },
  serverDate() { return Date.now(); }
};
const _ = {
  in: a => ({ __in: a }),
  neq: v => ({ __neq: v }),
  exists: v => ({ __exists: v }),
  lt: v => ({ __lt: v }),
  or: a => ({ __or: a }),
  inc: n => ({ __inc: n })
};
const cloud = {
  DYNAMIC_CURRENT_ENV: 'env',
  database: () => db,
  getWXContext: () => ({ OPENID: 'b1' }),
  async getTempFileURL({ fileList = [] }) {
    return { fileList: fileList.map(f => ({ fileID: f, tempFileURL: 'https://x/' + f })) };
  },
  async deleteFile({ fileList = [] }) {
    DELETED = DELETED.concat(fileList);
    return { fileList: fileList.map(f => ({ fileID: f, status: 0 })) };
  }
};
const mockSdk = {
  init() {}, db, cloud, database: () => db,
  getWXContext: cloud.getWXContext,
  async getTempFileURL(o) { return cloud.getTempFileURL(o); },
  async deleteFile(o) { return cloud.deleteFile(o); },
  DYNAMIC_CURRENT_ENV: 'env'
};
Module._load = function (request) {
  if (request === 'wx-server-sdk') return mockSdk;
  return origLoad.apply(this, arguments);
};

let pass = 0, failn = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failn++; console.log('  ✗ ' + n); } };

(async () => {
  const user = require(path.resolve('cloudfunctions/user/index.js'));

  console.log('\n[1] applyVerify — 未明示同意必须拒绝（服务端兜底）');
  const a1 = await user.main({
    action: 'applyVerify', realName: '张三', studentId: '20230101',
    school: '惠州经济职业技术学院', education: '本科',
    evidence: ['cloud://a.png']
  });
  check('无 agreed → code != 0', a1.code !== 0);
  check('提示语含「同意」', /同意/.test(a1.msg || ''));

  console.log('\n[2] applyVerify — 已同意则通过并留痕');
  const a2 = await user.main({
    action: 'applyVerify', realName: '张三', studentId: '20230101',
    school: '惠州经济职业技术学院', education: '本科',
    evidence: ['cloud://a.png'], agreed: true, agreedAt: 123456
  });
  check('code=0', a2.code === 0);
  const va = STORE.users[0].verifyApply;
  check('verifyApply.agreed = true', va.agreed === true);
  check('verifyApply.agreedAt = 123456', va.agreedAt === 123456);

  console.log('\n[3] reviewVerify 通过 — 清空 evidence 并真删云图片');
  // 还原一份带证据的申请
  STORE.users[0].verifyApply = {
    status: 'pending', school: '惠州经济职业技术学院', realName: '张三',
    studentId: '20230101', education: '本科',
    evidence: ['cloud://e1.png', 'cloud://e2.png']
  };
  DELETED = [];
  const r1 = await user.main({ action: 'reviewVerify', targetOpenid: 'b1', pass: true });
  check('code=0', r1.code === 0);
  check('verifyApply.evidence 已清空', Array.isArray(STORE.users[0].verifyApply.evidence) && STORE.users[0].verifyApply.evidence.length === 0);
  check('记录了 evidenceDeletedAt', !!STORE.users[0].verifyApply.evidenceDeletedAt);
  check('调用了 cloud.deleteFile', DELETED.length === 2);
  check('删除的是这批证据图', DELETED.includes('cloud://e1.png') && DELETED.includes('cloud://e2.png'));
  check('verified = true', STORE.users[0].verified === true);

  console.log('\n[4] reviewVerify 驳回 — 保留证据不删图');
  STORE.users[0].verified = false;
  STORE.users[0].verifyApply = {
    status: 'pending', school: '惠州经济职业技术学院',
    evidence: ['cloud://r1.png']
  };
  DELETED = [];
  const r2 = await user.main({ action: 'reviewVerify', targetOpenid: 'b1', pass: false, reason: '截图不清晰' });
  check('code=0', r2.code === 0);
  check('evidence 保留', STORE.users[0].verifyApply.evidence.length === 1);
  check('未删除云图片', DELETED.length === 0);
  check('驳回理由已写入', STORE.users[0].verifyApply.reason === '截图不清晰');
  check('状态为 rejected', STORE.users[0].verifyApply.status === 'rejected');

  console.log('\n=== 合计: ' + pass + ' 通过 / ' + failn + ' 失败 ===');
  process.exit(failn ? 1 : 0);
})();
