// cloudfunctions/school/index.js
// 学校清单与自提点下发（多校隔离的唯一数据源）。
//
// 设计要点：
// 1. 内置全国高校清单（教育部 2024.06 公布 + 少量兜底）作为兜底 —— 即使 schools / pickup_points 集合
//    不存在或为空，也绝不返回空数组。否则前端拿不到学校 → users.school 为空 → 无法发布、无法下单。
// 2. 内置清单维护在同目录 schools.json（约 2868 所，含本科/专科），require 一次缓存到内存，
//    不再像早期那样写死在 DEFAULT_SCHOOLS 里。
// 3. 数据库可覆盖 —— schools 集合里的学校会覆盖/追加到内置清单；pickup_points 集合按 campus
//    归并，优先级高于内置自提点。运营在后台增删学校无需改代码重新部署。
// 4. 本云函数是公开只读接口，不需要管理员鉴权（学校清单不是敏感数据）。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COL_SCHOOL = 'schools';
const COL_PICKUP = 'pickup_points';
const COL_USER = 'users';

const ok = d => ({ code: 0, data: d });
const fail = (msg, code = 1) => ({ code, msg });

// ---------------------------------------------------------------------------
// 内置默认学校清单（教育部 2024.06 完整名单 + 历史兜底）
//
// 数据来源：教育部官网 https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202406/t20240621_1136990.html
// 内容：2868 所普通高校（本科 1308 + 高职专科 1560），按办学层次（level）区分。
// 字段：{ name, level: '本科' | '专科' }
// 注意：高职专科名单也一并内置，方便学生填专科学校（如"深圳职业技术大学"）。
// ---------------------------------------------------------------------------
const OFFICIAL_SCHOOLS = require('./schools.json');

// 历史兜底：早期版本内置的"示例大学"，新数据已不含此项但仍保留以兼容
// 老数据（部分用户的 school 字段可能是"示例大学"）和 picker 体验。
const LEGACY_FALLBACK = [
  {
    name: '示例大学',
    sort: 0,
    pickupPoints: [
      { id: 'builtin_north_gate', name: '北门驿站', desc: '靠近地铁1号线' },
      { id: 'builtin_library', name: '图书馆一楼', desc: '工作日 8:00-22:00' },
      { id: 'builtin_dorm5', name: '宿舍区5号楼', desc: '楼下蜂巢柜' },
      { id: 'builtin_south_cafe', name: '南门咖啡角', desc: '周末也开放' }
    ]
  }
];

/** 深拷贝内置清单，避免运行期被污染 */
function builtin() {
  return [
    ...LEGACY_FALLBACK.map(s => ({
      name: s.name,
      sort: s.sort == null ? 0 : s.sort,
      pickupPoints: (s.pickupPoints || []).map(p => ({ ...p }))
    })),
    ...OFFICIAL_SCHOOLS.map((s, i) => ({
      name: s.name,
      sort: 100 + i, // 数据库学校 sort 默认 100+
      level: s.level || '',
      pickupPoints: [] // 教育部名单不带自提点，自提点走 pickup_points 集合或 LEGACY_FALLBACK
    }))
  ];
}

/**
 * 安全查询：集合不存在 / 无权限 / 查询失败时返回 null，而不是抛错中断整个下发流程。
 * 注意区分 null（查询失败）与 []（集合存在但为空）。
 */
async function safeGet(col, { orderBy, limit = 200 } = {}) {
  try {
    let q = db.collection(col);
    if (orderBy) q = q.orderBy(orderBy, 'asc');
    const r = await q.limit(limit).get();
    return r.data || [];
  } catch (e) {
    return null;
  }
}

/** 自提点归一化：去空、去重、截断长度，保证 id/name/desc 三字段稳定 */
function normalizePoints(arr) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((p, i) => {
    if (!p) return;
    const name = String(p.name || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({
      id: p.id || p._id || ('p_' + i),
      name: name.slice(0, 20),
      desc: String(p.desc || '').slice(0, 40)
    });
  });
  return out;
}

/**
 * 合并三份数据源，产出最终学校清单：
 *   内置 DEFAULT_SCHOOLS < schools 集合 < pickup_points 集合（后者覆盖前者）
 * @returns {Promise<Array<{name:string, pickupPoints:Array}>>}
 */
async function buildList() {
  const map = new Map();
  const put = (s) => {
    if (map.has(s.name)) return map.get(s.name);
    const item = { name: s.name, sort: s.sort == null ? 999 : s.sort, pickupPoints: s.pickupPoints || [] };
    map.set(s.name, item);
    return item;
  };

  builtin().forEach(put);

  // 1) schools 集合：同名覆盖（含自提点），异名追加；disabled 可下线内置学校
  const dbSchools = await safeGet(COL_SCHOOL, { orderBy: 'sort', limit: 200 });
  if (dbSchools && dbSchools.length) {
    dbSchools.forEach(s => {
      const name = String(s.name || '').trim();
      if (!name) return;
      const cur = put({ name, sort: s.sort });
      if (s.sort != null) cur.sort = Number(s.sort) || 999;
      if (s.disabled === true) cur.disabled = true;
      if (Array.isArray(s.pickupPoints) && s.pickupPoints.length) {
        cur.pickupPoints = normalizePoints(s.pickupPoints);
      }
    });
  }

  // 2) pickup_points 集合：按 campus 归并，优先级最高
  const dbPoints = await safeGet(COL_PICKUP, { limit: 500 });
  if (dbPoints && dbPoints.length) {
    const byCampus = {};
    dbPoints.forEach(p => {
      const campus = String(p.campus || '').trim();
      if (!campus) return;
      (byCampus[campus] = byCampus[campus] || []).push(p);
    });
    Object.keys(byCampus).forEach(campus => {
      const cur = put({ name: campus });
      const pts = normalizePoints(byCampus[campus]);
      if (pts.length) cur.pickupPoints = pts;
    });
  }

  return [...map.values()]
    .filter(s => !s.disabled)
    .sort((a, b) => (Number(a.sort) || 999) - (Number(b.sort) || 999) || String(a.name).localeCompare(String(b.name), 'zh'))
    .map(s => ({ name: s.name, pickupPoints: s.pickupPoints || [] }));
}

/**
 * buildList() 要合并「内置 2868 所清单 + DB 覆盖项」并排序、去重，结果有数百 KB。
 * 学校清单是**极低频变更**的数据，但每次用户切换学校 / 冷启都要全量重建一次。
 * 这里加进程内 60s 缓存（与 goods 列表缓存同思路）：期间直接复用，省掉重复构建与序列化开销。
 * 副作用：后台刚改的学校/自提点最迟 60s 后生效，对这类静态数据完全可接受。
 */
const LIST_TTL_MS = 60 * 1000;
let _listCache = null; // { at, payload }

async function buildListCached() {
  const now = Date.now();
  if (_listCache && now - _listCache.at < LIST_TTL_MS) return _listCache.payload;
  const list = await buildList();
  _listCache = { at: now, payload: list };
  return list;
}

const handlers = {
  /** 学校清单（含各校自提点） */
  async list() {
    const list = await buildListCached();
    return ok({ list, count: list.length, updatedAt: Date.now() });
  },

  /** 当前用户所在学校的自提点；未选学校返回空列表 */
  async pickups(_event, openid) {
    let mySchool = '';
    try {
      const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
      mySchool = (u.data && u.data[0] && u.data[0].school) || '';
    } catch (e) {}
    if (!mySchool) return ok({ school: '', list: [], needSchool: true });
    const list = await buildListCached();
    const hit = list.find(s => s.name === mySchool);
    return ok({ school: mySchool, list: (hit && hit.pickupPoints) || [] });
  },

  /** 健康检查，便于用 tools/probe_cloud.js 验证部署是否成功 */
  async ping() {
    return ok({ pong: true, service: 'school', time: Date.now() });
  }
};

exports.main = async (event = {}) => {
  const WX = cloud.getWXContext();
  const openid = WX.OPENID || WX.openid || '';
  const fn = handlers[event.action || 'list'];
  if (!fn) return fail('未知 action: ' + event.action);
  try {
    return await fn(event, openid);
  } catch (e) {
    console.error('school.' + event.action, e);
    // list 是最关键的下发接口：即使内部出错也要用内置清单兜底，绝不返回空
    if (event.action === 'list') {
      return ok({ list: builtin(), count: builtin().length, degraded: true, updatedAt: Date.now() });
    }
    return fail(e.message || '服务器错误', 500);
  }
};
