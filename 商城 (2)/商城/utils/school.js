// utils/school.js
// 学校列表获取与缓存（多校隔离的前端数据源）。
// 登录 picker / 编辑资料 / 认证页 / 自提点页共用，避免每个页面各自请求。

// 统一走 cloud.js 适配器（本地后端 mall-server / 云函数自动切换）
const { callFn } = require('./cloud.js');

const CACHE_KEY = 'cm_schools_v2'; // v2 = 增加教育部 2868 所 + level 字段；老缓存自动作废
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟（学校清单变化低频）

// ---------------------------------------------------------------------------
// 本地兜底数据：教育部 2024 年完整高校名单 2868 所（本科 1308 + 专科 1560）。
// 数据来自 utils/schools.js（同一份数据云函数侧也有，但这里作为前端兜底）。
//
// 为什么必须有兜底：云函数没上传时 wx.cloud.callFunction 会 fail，
// 此时必须有完整名单能让用户正常选学校。否则用户输入"惠州"什么都搜不到，
// 以为系统坏了，体验非常差。
//
// 兜底策略（getSchools 中）：云函数返回 < 100 项时视为"明显不全"，自动用本份数据。
//
// 注意：require('./schools.js') 放在 try-catch 里——万一微信 IDE 增量编译没把
// utils/schools.js / utils/schools.json 打进包（新增文件常见现象），这条 require
// 会抛 "module not found"。若不加保护，school.js 整个加载失败，会导致所有
// require 它的页面（登录/认证/资料/自提点）整页白屏。try-catch 后退回极小清单，
// 页面仍可用，只是候选少一些，等重新编译即可恢复完整 2868 所。
// ---------------------------------------------------------------------------
// 本地兜底数据：教育部 2024 年完整高校名单 2868 所（本科 1308 + 专科 1560）。
// 见文件顶部注释。为避免新增文件万一没被 IDE 打包导致顶层 require 抛错、
// 进而让所有引用 school.js 的页面整页白屏，这里改成【惰性加载 + try-catch】：
// 首次真正用到时才 require('./schools.js')，任何失败都退回极小兜底。
let _offlineCache = null;
function getOfflineSchools() {
  if (_offlineCache) return _offlineCache;
  try {
    const full = require('./schools.js');
    const arr = Array.isArray(full) ? full : (full && full.list) || [];
    _offlineCache = arr.length
      ? arr
      : [{ name: '示例大学', level: '', pickupPoints: [] }];
  } catch (e) {
    console.error('[school] 本地完整名单加载失败，已退回极小兜底：', e && e.message);
    _offlineCache = [{ name: '示例大学', level: '', pickupPoints: [] }];
  }
  return _offlineCache;
}

// 给个老字段名保持向后兼容（既有代码引用了 FALLBACK_SCHOOLS，作为函数导出）
const FALLBACK_SCHOOLS = getOfflineSchools;

/** 只保留结构合法的学校项，剔除脏数据 */
function normalize(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(s => s && String(s.name || '').trim())
    .map(s => ({
      name: String(s.name).trim(),
      level: String(s.level || '').trim(), // 本科 / 专科（前端候选用 wx:if 显示）
      pickupPoints: (Array.isArray(s.pickupPoints) ? s.pickupPoints : [])
        .filter(p => p && String(p.name || '').trim())
        .map(p => ({
          id: p.id || '',
          name: String(p.name).trim(),
          desc: String(p.desc || '')
        }))
    }));
}

/** 把 {name,level} 平铺为 [{name,level,pickupPoints:[]}] 形态，方便前端选 + 显示 */
function enrich(list) {
  return list.map(s => ({
    name: s.name,
    level: s.level || '',
    pickupPoints: [] // 本地兜底没有自提点；自提点请以云函数返回为准
  }));
}

/**
 * 获取学校列表 [{ name, level, pickupPoints: [{id,name,desc}] }]
 * 三级降级：缓存 → school 云函数 → 本地 2868 所兜底。正常情况下**永不返回空数组**。
 * @param {boolean} force 跳过缓存强制刷新
 * @returns {Promise<Array>}
 */
function getSchools(force = false) {
  if (!force) {
    try {
      const c = wx.getStorageSync(CACHE_KEY);
      if (c && Array.isArray(c.list) && c.list.length && Date.now() - c.at < CACHE_TTL) {
        return Promise.resolve(c.list);
      }
    } catch (e) {}
  }
  return new Promise(resolve => {
    // 三级降级链：云函数（含自提点）→ 本地 2868 所（无自提点）→ 内存兜底
    const offline = () => resolve(enrich(getOfflineSchools()));
    // 改走 cloud.js 统一适配器（本地后端/云函数自动切换）
    callFn('school', { action: 'list' })
      .then(env => {
        const list = normalize(env && env.data && env.data.list);
        // 关键：云函数返回数据太少（< 100 所，说明云函数没上传教育部那份）
        // 自动用本地完整名单补齐，避免「输入"惠州"什么都搜不到」
        if (!list.length || list.length < 100) {
          console.warn('[school] 云函数返回数据不足（' + list.length + '），用本地 2868 所兜底');
          return resolve(enrich(getOfflineSchools()));
        }
        try { wx.setStorageSync(CACHE_KEY, { at: Date.now(), list }); } catch (e) {}
        resolve(list);
      })
      // 未部署 / 网络异常 / 超时：用本地 2868 所兜底，不阻塞页面
      .catch(() => {
        console.warn('[school] 学校接口调用失败，用本地 2868 所兜底');
        resolve(enrich(getOfflineSchools()));
      });
  });
}

/** 清除学校缓存（学校清单更新或切换账号后调用） */
function clearSchoolCache() {
  try { wx.removeStorageSync(CACHE_KEY); } catch (e) {}
}

/** 安全读取当前用户学校，避免 getApp() 未初始化时抛错 */
function getMySchool() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    return (app && app.globalData && app.globalData.userInfo && app.globalData.userInfo.school) || '';
  } catch (e) {
    return '';
  }
}

/**
 * 当前用户学校对应的自提点；未选学校返回 []
 * 优先走 school 云函数的 pickups（服务端以 users.school 为准，最权威），
 * 失败再降级到本地学校清单里查找。
 */
async function getMyPickupPoints() {
  const my = getMySchool();
  if (!my) return [];
  try {
    // 改走统一适配器（本地后端/云函数自动切换）
    const env = await callFn('school', { action: 'pickups' });
    const d = env && env.data;
    if (d && Array.isArray(d.list)) return d.list;
  } catch (e) {}
  const schools = await getSchools();
  const hit = schools.find(s => s.name === my);
  return hit ? hit.pickupPoints || [] : [];
}

module.exports = { getSchools, getMyPickupPoints, clearSchoolCache, getMySchool, FALLBACK_SCHOOLS, CACHE_KEY };
