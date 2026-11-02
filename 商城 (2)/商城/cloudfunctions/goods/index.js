// cloudfunctions/goods/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COL_GOODS = 'goods';
const COL_USER = 'users';
const COL_FAV = 'favorites';
const COL_WANT = 'wants';
const COL_VIEWLOG = 'viewLogs';
const SENSITIVE = require('./sensitive-words.js');

const ok = d => ({ code: 0, data: d });
const fail = (msg, code = 1) => ({ code, msg });

/**
 * 写入自愈：云开发 add 到「不存在的集合」会抛 -502005，不会自动建集合。
 * 捕获 -502005 后先 createCollection 再重试，避免空库/老库首次发布直接 500。
 */
async function ensureAdd(collection, data) {
  try { return await db.collection(collection).add({ data }); }
  catch (e) {
    const msg = (e && e.message) || '';
    const code = e && e.errCode;
    if (code === -502005 || msg.indexOf('not exists') !== -1 || msg.indexOf('ResourceNotFound') !== -1) {
      try { await db.createCollection(collection); } catch (e2) { console.error('createCollection fail', collection, e2 && e2.message); }
      return await db.collection(collection).add({ data });
    }
    throw e;
  }
}

/**
 * 按指定 _id 幂等写入（存在则覆盖），带 -502005 建集合自愈。
 * 用于 viewLogs 这类「确定性 _id」记录：并发重复写入只落到同一文档。
 * ⚠️ data 里不能带 _id（云开发会报 -501007「不能更新_id的值」），统一剥离。
 */
async function ensureSet(collection, id, data) {
  const d = Object.assign({}, data);
  delete d._id;
  try { return await db.collection(collection).doc(id).set({ data: d }); }
  catch (e) {
    const msg = (e && e.message) || '';
    const code = e && e.errCode;
    if (code === -502005 || msg.indexOf('not exists') !== -1 || msg.indexOf('ResourceNotFound') !== -1) {
      try { await db.createCollection(collection); } catch (e2) { /* 已存在则忽略 */ }
      return await db.collection(collection).doc(id).set({ data: d });
    }
    throw e;
  }
}

/**
 * 浏览量去重累加：同一「用户×商品」只计一次。
 * 原实现 `detail` 里无条件 `viewCount: _.inc(1)` —— 同一用户反复进出详情页、
 * 或脚本高频调用都会虚增浏览量，进而抬高「hot」排序（`viewCount desc`）。
 * 这里用确定性 _id（openid_goodsId）记「谁看过」，首次才 +1；重复查看不再累计。
 * 失败降级为「本次不计浏览量」，绝不阻断详情返回。
 */
async function bumpView(goodsId, openid) {
  try {
    const detId = `${openid}_${goodsId}`;
    const exist = await db.collection(COL_VIEWLOG).doc(detId).get().catch(() => null);
    if (exist && exist.data) return;
    await ensureSet(COL_VIEWLOG, detId, { _openid: openid, goodsId, createdAt: Date.now() });
    await db.collection(COL_GOODS).doc(goodsId).update({ data: { viewCount: _.inc(1) } }).catch(() => {});
  } catch (e) {
    console.error('bumpView fail', goodsId, e && e.message);
  }
}

/**
 * 给 Promise 套一个超时上限：超时不再死等，直接返回 fallback。
 * 用于隔离「嵌套云函数调用」等不可控耗时，避免拖垮主流程触发 -504003。
 */
function withTimeout(p, ms, fallback) {
  return Promise.race([
    p,
    new Promise(r => setTimeout(() => { console.error('[goods] timeout guard hit', ms); r(fallback); }, ms))
  ]);
}

function checkContent(title, desc) {
  const all = [title || '', desc || ''].join('\n');
  const hit = SENSITIVE.SENSITIVE_WORDS.find(w => all.indexOf(w) !== -1);
  return hit ? `内容含违禁词「${hit}」，请修改` : '';
}

const PUBLISH_CREDIT_MIN = 60;
const PRICE_MAX = 999999; // 硬上限，防止恶意/误填天价
const MAX_IMAGES = 9;
const MAX_PAGE_SIZE = 50;
const MAX_KEYWORD_LEN = 30;
const MAX_DESC_LEN = 1000;

/**
 * 合法分类 key 白名单。
 *
 * ⚠️ 必须与小程序端 utils/categories.js 的 CATEGORIES 保持一致。
 * 云函数无法 require 小程序端模块（部署时只打包本目录），所以这里维护副本；
 * 有 scripts/check-category-sync.js 做本地一致性校验，也有下面的自检日志兜底。
 *
 * 加白名单的目的：此前 publish/update 对 category 完全不做校验，
 * 客户端传什么就存什么 —— 脏 key（拼错、中文名、任意字符串）会静默入库，
 * 结果是商品在分类页永远搜不到（筛选按 key 精确匹配），且后台无法归类。
 */
const CATEGORY_MAP = {
  book: '教材书籍', digital: '数码电子', dorm: '宿舍神器', clothes: '服饰鞋包',
  sports: '运动户外', beauty: '美妆护肤', bike: '代步出行', ticket: '票券卡券',
  life: '生活日用', other: '其他闲置'
};
const CATEGORY_KEYS = Object.keys(CATEGORY_MAP);

/** key → 中文名。兼容历史脏数据：写入的是中文名时原样返回；未知 key 原样返回（便于排查） */
function categoryText(key) {
  if (!key) return '';
  return CATEGORY_MAP[key] || String(key);
}

/** 价格合法性：必须是正数且不超过上限 */
function checkPrice(v, label = '价格') {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return `请填写有效的${label}`;
  if (n > PRICE_MAX) return `${label}不能超过 ${PRICE_MAX}`;
  return '';
}

/** 转义正则元字符：用户输入直接进 db.RegExp 会因语法错误报 500，也可能被构造 ReDoS */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const clampPage = (page, pageSize, def = 20) => ({
  p: Math.max(1, Number(page) || 1),
  size: Math.max(1, Math.min(MAX_PAGE_SIZE, Number(pageSize) || def))
});

/** 被封禁用户只读：不能发布/编辑/下单 */
function bannedErr(me) {
  return me && me.status === 'banned' ? '账号已被封禁，无法进行该操作' : '';
}

/**
 * 临时链接缓存：cloud.getTempFileURL 是外部 API，单次约 380ms，
 * 实测占 goods.list 总耗时（~800ms）的近一半。云函数实例复用期间缓存结果 → 命中后 0 网络开销。
 *
 * 【TTL 必须显著小于临时链接自身有效期】微信云存储「私有读」文件的临时链接**默认只有
 * 10 分钟有效期**（官方文档：公有读不过期、私有读十分钟；实测 5 分钟正常、28 分钟已 403）。
 * 若缓存时间超过它，就会把「快过期/已过期」的链接发给客户端 → 前端 403 裂图
 *（这正是线上「图片不见了」的成因之一）。
 * 取 3 分钟：足以覆盖用户连续翻页/返回的请求，又给客户端留足余量。
 */
const _urlCache = new Map();
const URL_CACHE_TTL = 3 * 60 * 1000;
const URL_CACHE_MAX = 800; // 上限，防内存无限膨胀

/**
 * 列表结果缓存（服务端）：goods.list 是首页 / 分类 / 搜索 / 我的商品 的共同热点，
 * 冷请求实测 ~800ms（decorate 三路 DB + getTempFileURL）。同云函数实例复用期内缓存结果，
 * 命中后跳过 DB 与 decorate，响应降到 ~10-50ms。
 *
 *   - key 含 openid（调用者）与 _openid（他人主页）：收藏/想要态、学校隔离天然正确，不会串用户。
 *   - 写操作（publish/update/setStatus/remove）会置 _goodsListDirtyAt；list 在「刚写过」的
 *     TTL 窗口内跳过缓存，保证新上架 / 改价 / 上下架立即可见，不被缓存挡住。
 *   - 跨实例不共享缓存：多实例下某浏览者可能看到至多 LIST_CACHE_TTL 内的旧列表，可接受
 *     （首页本身还有客户端 60s SWR + 6min 换链兜底）。
 */
const _listCache = new Map();
const LIST_CACHE_TTL = 10 * 1000;
const LIST_CACHE_MAX = 200;
let _goodsListDirtyAt = 0;

function listCacheKey(p) {
  return [
    p.openid || '', p._openid || '', p.type || '', p.category || '',
    p.keyword || '', p.condition || '', (p.minPrice == null ? '' : p.minPrice),
    (p.maxPrice == null ? '' : p.maxPrice), p.sort || '', p.page || 1,
    p.pageSize || 20, p.status || '', p.school || ''
  ].join('|');
}
function listCacheGet(key) {
  const hit = _listCache.get(key);
  if (!hit) return null;
  if (hit.expireAt > Date.now()) return hit.data;
  _listCache.delete(key);
  return null;
}
function listCacheSet(key, data) {
  if (_listCache.size >= LIST_CACHE_MAX) {
    const k = _listCache.keys().next().value;
    if (k !== undefined) _listCache.delete(k);
  }
  _listCache.set(key, { data, expireAt: Date.now() + LIST_CACHE_TTL });
}

/**
 * 调用者学校缓存：list 每请求都要先查一次 users 拿 mySchool 做多校隔离（~30-50ms）。
 * 学校极少变动，按 openid 缓存 60s，省一次 DB 往返。
 */
const _callerSchool = new Map();
const CALLER_SCHOOL_TTL = 60 * 1000;
async function callerSchool(openid) {
  const hit = _callerSchool.get(openid);
  if (hit && hit.expireAt > Date.now()) return hit.school;
  const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
  const school = (u.data && u.data[0] && u.data[0].school) || '';
  _callerSchool.set(openid, { school, expireAt: Date.now() + CALLER_SCHOOL_TTL });
  return school;
}

/**
 * 给云存储临时 URL 追加 COS 图片处理参数（数据万象 imageMogr2），让渲染层直接拿小图。
 *
 * 背景：用户从相册/相机选的图常是 2560x1440 的 PNG（单张 4~6MB）。小程序 <image> 渲染层
 * 加载这种大图会直接报 `[渲染层网络层错误] Failed to load image`（net::OK，网络没问题，
 * 是渲染/解码层扛不住），同时也让首屏图片极慢。
 *
 * 实测（同一张 2560x1440 / 4286.7KB 的 PNG）：
 *   `&imageMogr2/thumbnail/1080x/format/jpg/quality/80` → 52.2KB JPEG（约 1/82）
 *   `&imageMogr2/thumbnail/750x/format/jpg/quality/75`  → 25.7KB JPEG
 * 好处：零迁移 —— 不动已存在的文件、不需要重新上传，只在生成 URL 时加后缀。
 *
 * 【务必用 `&` 追加】临时 URL 形如 `...?sign=xxx&t=xxx`，若覆盖查询串（用 `?`）会导致
 * 签名校验失败返回 403。
 *
 * @param {string} url   cloud.getTempFileURL 返回的临时链接
 * @param {number} width 缩放后的长边像素
 * @param {number} quality JPEG 质量
 */
function imgThumb(url, width = 750, quality = 80) {
  if (typeof url !== 'string' || url.indexOf('http') !== 0) return url; // 非 http（如原始 cloud://）不动
  if (url.indexOf('imageMogr2') >= 0) return url;                       // 已处理过，避免重复追加
  if (url.indexOf('tcb.qcloud.la') < 0 && url.indexOf('myqcloud.com') < 0) return url; // 仅云存储域名
  return url + '&imageMogr2/thumbnail/' + width + 'x/format/jpg/quality/' + quality;
}

// 不同场景的目标尺寸：列表/网格只需小图，详情要能放大看
const THUMB_LIST = 750;     // 首页 / 分类 / 搜索 / 我的商品 / 收藏 封面
const THUMB_DETAIL = 1280;  // 详情轮播（可放大查看，同时仍远小于原图）
const THUMB_AVATAR = 200;   // 头像

async function resolveUrls(fileIds) {
  const now = Date.now();
  const out = {};
  const need = [];
  for (const fid of fileIds) {
    const hit = _urlCache.get(fid);
    if (hit && hit.expireAt > now) out[fid] = hit.url;
    else need.push(fid);
  }
  if (!need.length) return out;
  try {
    const tr = await cloud.getTempFileURL({ fileList: need });
    (tr.fileList || []).forEach(it => {
      if (!it.tempFileURL) return;
      out[it.fileID] = it.tempFileURL;
      if (_urlCache.size >= URL_CACHE_MAX) {
        // 简单的容量控制：淘汰最早写入的一半
        const keys = [..._urlCache.keys()].slice(0, Math.ceil(URL_CACHE_MAX / 2));
        keys.forEach(k => _urlCache.delete(k));
      }
      _urlCache.set(it.fileID, { url: it.tempFileURL, expireAt: now + URL_CACHE_TTL });
    });
  } catch (e) { console.error('getTempFileURL fail', e && e.message); }
  return out;
}

/**
 * 补充卖家信息、收藏状态与图片临时链接。
 * @param {Array} list 商品文档
 * @param {string} openid 当前调用者
 * @param {boolean} keepOpenid 是否保留商品归属 openid。
 *   列表场景一律 false —— openid 可被用来构造聊天 convId，没必要全量暴露；
 *   商品详情页为 true —— 「私聊」「查看主页」需要卖家 openid。
 */
async function decorate(list, openid, { keepOpenid = false, light = false } = {}) {
  if (!list || !list.length) return [];
  const openids = [...new Set(list.map(g => g._openid))];
  const ids = list.map(g => g._id);
  // 三路 DB 查询并行（原本串行，实测 list 总耗时 800ms 里有近一半耗在这几段 IO 上）
  const [userRes, favRes, wantRes] = await Promise.all([
    db.collection(COL_USER)
      .where({ _openid: _.in(openids) })
      .field({ _openid: true, nickName: true, avatarUrl: true, verified: true, credit: true, school: true })
      .get(),
    // 集合不存在（用户从未收藏过、集合还没被创建）时降级为空集合。
    // 绝不能让"辅助查询失败"把整个商品列表带崩成 500。
    openid
      ? db.collection(COL_FAV).where({ _openid: openid, goodsId: _.in(ids) }).get().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    // wants 是「想要数」功能新引入的集合，老库里根本不存在；查询失败静默降级即可
    openid
      ? db.collection(COL_WANT).where({ _openid: openid, goodsId: _.in(ids) }).get().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] })
  ]);

  const map = {};
  // 头像兜底：http:// 失效临时路径清空走默认头像；cloud:// 换 https
  const sellerAvatarIds = userRes.data
    .map(u => u.avatarUrl).filter(f => f && f.startsWith('cloud://'));
  const sellerAvatarUrlMap = sellerAvatarIds.length ? await resolveUrls(sellerAvatarIds) : {};
  userRes.data.forEach(u => {
    let av = u.avatarUrl;
    if (av && (av.startsWith('wxfile://') || av.startsWith('http://'))) av = ''; // 失效临时路径（wx.chooseAvatar 旧版 http 临时链 / 新版 wxfile 临时链）
    else if (av && av.startsWith('cloud://')) av = imgThumb(sellerAvatarUrlMap[av], THUMB_AVATAR) || av; // cloud:// 换 https（顺带缩放）
    // _openid 只用于内部匹配，不写进 sellerInfo 返回给客户端
    map[u._openid] = {
      nickName: u.nickName,
      avatarUrl: av,
      verified: u.verified,
      credit: u.credit == null ? 100 : Math.max(0, Math.min(100, Math.round(Number(u.credit)))),
      school: u.school || ''
    };
  });

  const favSet = new Set((favRes.data || []).map(f => f.goodsId));
  const wantSet = new Set((wantRes.data || []).map(f => f.goodsId));

  // 图片临时链接解析：
  //  - 列表模式（light=true）：网格只展示封面，只解析 cover 一个 fileID。
  //    此前把每个商品的全部 images（最多 9 张）都拿去 getTempFileURL，
  //    首页 20 个商品 × 平均多图 = 上百个 fileID 一次转换，是首屏图片慢的主因。
  //    未解析的 images 保留原始 cloud:// fileID，<image> 可直接渲染（同环境），
  //    详情页会再传 keepOpenid 且非 light，届时才解析全部。
  //  - 详情模式（light=false）：解析 cover + 全部 images（详情轮播需要）。
  const fileIds = [];
  for (const g of list) {
    if (!light && Array.isArray(g.images)) g.images.forEach(f => f && fileIds.push(f));
    if (g.cover) fileIds.push(g.cover);
  }
  const uniq = [...new Set(fileIds)];
  const urlMap = uniq.length ? await resolveUrls(uniq) : {};
  // 原图常见 4~6MB（2560x1440 PNG），直接丢给渲染层会加载失败/极慢。
  // 这里统一用 imageMogr2 就地缩放：列表 750 / 详情 1280，实测可降到几十 KB。
  const W = light ? THUMB_LIST : THUMB_DETAIL;

  return list.map(g => {
    const images = Array.isArray(g.images) ? g.images.map(f => imgThumb(urlMap[f], W) || f) : [];
    const cover = imgThumb(urlMap[g.cover], W) || g.cover || images[0] || '';
    const item = {
      ...g,
      cover, images,
      // 分类中文名：客户端此前直接渲染 `category`（英文 key），用户看到 book/digital。
      // 服务端统一下发中文名，各页面直接展示，避免每个页面各写一份映射（漏改就露英文）。
      categoryText: categoryText(g.category),
      faved: favSet.has(g._id),
      wanted: wantSet.has(g._id),
      sellerInfo: map[g._openid] || {}
    };
    if (!keepOpenid) delete item._openid;
    return item;
  });
}

const handlers = {
  /** 商品列表（首页信息流 / 分类 / 搜索 / 个人主页）
   *  多校隔离：除个人主页（_openid）外，只返回调用者本校（users.school）的商品，
   *  学校以服务端用户记录为准，不信任客户端传参。
   */
  async list({ page = 1, pageSize = 20, category, keyword, condition, minPrice, maxPrice, sort = 'new', type, _openid, status } = {}, openid) {
    const where = {};
    // 多校隔离条件必须放在**顶层** _.or（见下方 ⚠️ 说明），不能塞进 where.campus。
    // 这里单独持有，最后与 where 一起 `_.and([...])` 组合。
    let campusOr = null;
    let mySchool = '';
    if (_openid) {
      // 个人主页场景：看指定卖家的商品，不做学校过滤；status 由调用方控制
      where._openid = _openid;
      if (status) where.status = status;
    } else {
      where.status = status || 'onSale';
      // 调用者学校（缓存 60s）：多校隔离只展示本校商品
      mySchool = await callerSchool(openid);
      if (mySchool) {
        // 已选校：多校隔离，仅看本校；兼容历史数据——
        // 本校用户也能看到「未标记校区 / campus 字段缺失」的遗留商品。
        // 注意：云数据库里 _.in(['', null]) 匹配不到「字段根本不存在」的文档，
        //       必须显式用 _.exists(false) 才能覆盖，否则这类老商品会被整批漏掉。
        //
        // ⚠️⚠️ 云开发坑（**已用「插入外校商品」对照实验实测复现**，勿改回）：
        //   写成 `where.campus = _.or([...])`（把 _.or 赋值给某个字段）会**静默失效** ——
        //   云开发忽略整个 campus 条件、不报错，外校商品照样被查出来（多校隔离形同虚设）。
        //   实测数据（goods 集合 onSale 共 6 条本校 + 临时插入 1 条外校）：
        //     `where.campus = _.or([...])`  → 7 条，**含外校** ❌
        //     `_.and([where, _.or([...])])` → 6 条，不含外校 ✅
        //     `where.campus = mySchool`     → 6 条，不含外校 ✅
        //   与 type 过滤（见下方注释）、myGoods/myFavs 是**同一个坑**：
        //   **凡是「或」条件，一律提到顶层用 _.or / _.and 组合，绝不赋值给字段。**
        campusOr = _.or([
          { campus: mySchool },
          { campus: _.in(['', null]) },
          { campus: _.exists(false) }
        ]);
      }
      // 未选校：不再硬拦截返回空列表（否则首页一片空白、像坏了）。
      // 改为放行全部商品 + 前端提示选校，方便单校试点 / 未认证用户也能浏览。
    }
    if (category) where.category = category;
    // 历史数据兼容：商品库内大量旧文档没有 type 字段。
    //   type='want'  严格只查 want
    //   type='sell'  查 sell + 没字段 + null（视为默认出售）
    //   其余（不传 / 'all'）不按 type 过滤
    // ⚠️ 云开发坑（已实测复现）：
    //    `where.type = _.or([{type:'sell'}, {type:_.exists(false)}, {type:null}])`
    //    这种「字段值位置放嵌套对象条件」的写法**完全不生效** —— 云开发会静默忽略整个
    //    type 条件（不报错），导致「闲置」列表里混进求购商品（首页 sell tab 出现求购）。
    //    改为 _.neq('want')：语义等价（排除求购 = 其余都是出售，含历史无 type 文档），
    //    实测精确生效（另有 myGoods/myFavs 同类修复，见 cloudfunctions/user）。
    if (type === 'want') {
      where.type = 'want';
    } else if (type === 'sell') {
      where.type = _.neq('want');
    }
    if (condition) where.condition = condition;
    if (minPrice !== undefined && minPrice !== null && minPrice !== '') where.price = _.gte(Number(minPrice));
    if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
      where.price = where.price ? _.and(where.price, _.lte(Number(maxPrice))) : _.lte(Number(maxPrice));
    }

    const { p, size } = clampPage(page, pageSize);

    // —— 列表结果缓存：命中则跳过 DB + decorate（冷请求 ~800ms → 命中 ~50ms）——
    // 写入后 TTL 窗口内（_goodsListDirtyAt）强制跳过缓存，保证新上架/改价立即可见。
    const _key = listCacheKey({
      openid, _openid, type, category, keyword, condition,
      minPrice, maxPrice, sort, page: p, pageSize: size,
      status: (_openid ? status : (status || 'onSale')), school: mySchool
    });
    if (Date.now() - _goodsListDirtyAt >= LIST_CACHE_TTL) {
      const _cached = listCacheGet(_key);
      if (_cached) return _cached;
    }

    // —— 组装最终 where ——
    // 把「或」类条件（多校隔离 campusOr、关键词 kw）统一提成顶层 _.or，
    // 与 where 用 _.and 组合。**绝不要把 _.or 赋值给某个字段**（会静默失效，见上）。
    let query = db.collection(COL_GOODS).where(where);
    // 关键词需转义：直接把用户输入塞进 db.RegExp，遇到 ( [ * 等字符会报错 500
    const kw = String(keyword == null ? '' : keyword).trim().slice(0, MAX_KEYWORD_LEN);

    const ors = [];
    if (campusOr) ors.push(campusOr);
    if (kw) {
      const re = db.RegExp({ regexp: escapeRegex(kw), options: 'i' });
      ors.push(_.or([{ title: re }, { desc: re }]));
    }
    if (ors.length) {
      query = db.collection(COL_GOODS).where(ors.length === 1 ? _.and([where, ors[0]]) : _.and([where, ...ors]));
    }

    if (sort === 'priceAsc') query = query.orderBy('price', 'asc');
    else if (sort === 'priceDesc') query = query.orderBy('price', 'desc');
    else if (sort === 'hot') query = query.orderBy('viewCount', 'desc').orderBy('createdAt', 'desc');
    else query = query.orderBy('createdAt', 'desc');

    const r = await query.skip((p - 1) * size).limit(size).get();
    // 列表场景只解析封面图（网格只展示封面），显著降低 getTempFileURL 开销
    const list = await decorate(r.data, openid, { light: true });
    const result = ok({ list, hasMore: r.data.length === size, school: mySchool, needSchool: !mySchool });
    listCacheSet(_key, result); // 落盘缓存（仅在未走「刚写入」跳过分支时）
    return result;
  },

  async detail({ id }, openid) {
    if (!id) return fail('缺少 id');
    const r = await db.collection(COL_GOODS).doc(id).get();
    if (!r.data) return fail('商品不存在', 404);
    await bumpView(id, openid); // 浏览量去重累加（每用户每商品只 +1）
    // 详情页保留 _openid：私聊与查看卖家主页需要
    const [arr] = await decorate([r.data], openid, { keepOpenid: true });
    return ok(arr);
  },

  async publish({ title, desc, images, price, originalPrice, category, condition, pickupPoint, type = 'sell' } = {}, openid) {
    const isWant = type === 'want';
    const contentErr = checkContent(title, desc);
    if (contentErr) return fail(contentErr);
    if (!title || !String(title).trim() || String(title).trim().length < 2 || String(title).trim().length > 30) {
      return fail('标题需 2~30 个字');
    }
    if (!category) return fail('请选择分类');
    // 分类 key 白名单校验：拒绝脏 key 入库。
    // 此前不校验，客户端可写入任意字符串 —— 商品在分类页永远搜不到（筛选按 key 精确匹配），
    // 且后台商品管理无法归类。给出可用分类提示，便于定位。
    if (!CATEGORY_MAP[category]) {
      return fail(`分类「${String(category).slice(0, 20)}」不存在，请重新选择`);
    }
    const imgArr = images || [];
    if (!isWant && (!imgArr.length)) return fail('至少上传一张图');
    if (imgArr.length > MAX_IMAGES) return fail(`最多上传 ${MAX_IMAGES} 张图`);
    if (desc && String(desc).length > MAX_DESC_LEN) return fail(`描述不能超过 ${MAX_DESC_LEN} 字`);

    // 价格：求购为「预算」选填，出售为必填
    let priceVal = null;
    if (price !== undefined && price !== null && String(price).trim() !== '') {
      const priceErr = checkPrice(price);
      if (priceErr) return fail(priceErr);
      priceVal = Number(price);
    } else if (!isWant) {
      return fail('请填写价格');
    }
    if (!isWant && originalPrice !== undefined && originalPrice !== null && originalPrice !== '') {
      const opErr = checkPrice(originalPrice, '原价');
      if (opErr) return fail(opErr);
    }

    const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
    const me = u.data && u.data[0];
    if (!me) return fail('用户不存在', 404);
    if (bannedErr(me)) return fail(bannedErr(me), 403);
    // 信用分统一口径 0~100（库里可能有 >100 的历史越界值），发布门槛判断与展示必须一致
    const credit = me.credit == null || isNaN(Number(me.credit))
      ? 100
      : Math.max(0, Math.min(100, Math.round(Number(me.credit))));
    if (credit < PUBLISH_CREDIT_MIN) return fail(`信用分低于 ${PUBLISH_CREDIT_MIN}，已暂停发布功能`, 403);
    // 多校隔离：商品归属学校以卖家资料为准（campus 忽略客户端传值）
    if (!me.school) return fail('请先在「我的-编辑资料」选择学校后再发布', 403);

    // 图片上传并发化：原先 `for + await` 串行，9 张图 = 9 次网络往返，
    // 拖长发布耗时（叠加冷启动极易触 -504003，发布直接失败）。
    // 改为「按序分批并发」（每批 3 张），promise 按 index 回填，保证图片顺序不乱、首图仍是封面。
    const slots = imgArr.map(() => '');
    const pendingIdx = [];
    imgArr.forEach((img, idx) => {
      if (typeof img === 'string' && img.startsWith('cloud://')) { slots[idx] = img; return; }
      if (typeof img === 'string' && img.startsWith('data:image')) pendingIdx.push(idx);
    });
    const UPLOAD_CONCURRENCY = 3;
    for (let i = 0; i < pendingIdx.length; i += UPLOAD_CONCURRENCY) {
      const batch = pendingIdx.slice(i, i + UPLOAD_CONCURRENCY);
      const rs = await Promise.all(batch.map(async idx => {
        const cloudPath = `goods/${openid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        try {
          const res = await cloud.uploadFile({ cloudPath, fileContent: Buffer.from(imgArr[idx].split(',')[1], 'base64') });
          return (res && res.fileID) || '';
        } catch (e) { console.error('upload fail', e); return ''; }
      }));
      batch.forEach((idx, k) => { slots[idx] = rs[k]; });
    }
    const uploaded = slots.filter(Boolean);
    if (!isWant && !uploaded.length) return fail('图片上传失败，请重试');

    // 内容安全检测
    // 策略：文本同步必检（违禁文字不能展示给任何人），图片异步后台检（图片 seccheck 单次
    // 2-3s 会拖垮 publish 触发 -504003 3s 超时）。risky 图片由定时触发器扫到后自动下架。
    try {
      const [me2, textCheck] = await Promise.all([
        // 复用前面已经查过的 me，但这里作为并行起点（publish 流程里 user lookup 在前）
        Promise.resolve(me),
        // 超时保护：seccheck 是「嵌套云函数调用」，冷启动实测可达 2.2s；
        // 若与 goods 自身冷启动叠加就会突破 3s 上限触发 -504003，发布直接失败。
        // 这里给它 2s 硬上限，超时视为「检测未生效」放行，绝不拖垮发布主流程。
        withTimeout(
          cloud.callFunction({ name: 'seccheck', data: { action: 'text', content: (title + '\n' + (desc || '')) } }),
          2000, null
        )
      ]);
      if (textCheck && textCheck.result && textCheck.result.data && textCheck.result.data.risky) {
        return fail('内容包含违规信息，发布失败');
      }
    } catch (e) { console.error('seccheck text (goods) fail', e); }

    const now = Date.now();
    const doc = {
      _openid: openid,
      title, desc: desc || '',
      images: uploaded, cover: uploaded[0] || '',
      price: priceVal,
      originalPrice: !isWant && originalPrice ? Number(originalPrice) : null,
      category, condition: isWant ? 'normal' : (condition || 'normal'),
      campus: me.school,
      pickupPoint: pickupPoint || '',
      type: isWant ? 'want' : 'sell',
      // 上架审核流：新商品先进「待审核」（pending），管理员在管理后台确认后才 onSale；
      // 驳回则转 off（offReason 记原因）。商品始终可在管理后台「商品管理」查看。
      status: 'pending',
      reviewedAt: 0,
      // 图片安全检测：异步后台跑（见 exports.main 里的 timer 分支 + pendingImgCheck 动作）
      //  - 有封面图：先入库，标 'pending'，定时器后台检完后改为 'safe' / 'risky'
      //  - 求购无图：直接 'safe'
      //  - 旧存量商品（无此字段）：decorate 视为 'safe'，不重复检
      imgCheckStatus: uploaded[0] ? 'pending' : 'safe',
      viewCount: 0, favCount: 0, wantCount: 0,
      createdAt: now, updatedAt: now
    };
    const r = await ensureAdd(COL_GOODS, doc);
    await db.collection(COL_USER).doc(me._id).update({ data: { publishedCount: _.inc(1) } });
    // 写操作使首页/列表缓存失效：接下来 10s 内的 list 请求跳过缓存，保证新商品立即可见
    _goodsListDirtyAt = Date.now();
    return ok({ _id: r._id });
  },

  async update({ id, patch }, openid) {
    if (!id) return fail('缺少 id');
    const g = await db.collection(COL_GOODS).doc(id).get();
    if (!g.data) return fail('商品不存在', 404);
    if (g.data._openid !== openid) return fail('无权操作', 403);
    const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
    if (bannedErr(u.data && u.data[0])) return fail(bannedErr(u.data && u.data[0]), 403);
    if (patch && patch.title !== undefined) {
      const contentErr = checkContent(patch.title, patch.desc);
      if (contentErr) return fail(contentErr);
      if (String(patch.title).trim().length < 2 || String(patch.title).trim().length > 30) {
        return fail('标题需 2~30 个字');
      }
    }
    // 分类 key 白名单校验（与 publish 一致）：脏 key 会让商品在分类页永远搜不到
    if (patch && patch.category !== undefined && patch.category !== '') {
      if (!CATEGORY_MAP[patch.category]) {
        return fail(`分类「${String(patch.category).slice(0, 20)}」不存在，请重新选择`);
      }
    }
    // 此前白名单字段直接写入，价格零校验：负数/天价都能改。这里统一校验
    if (patch && patch.price !== undefined) {
      const e = checkPrice(patch.price);
      if (e) return fail(e);
    }
    if (patch && patch.originalPrice !== undefined && patch.originalPrice !== null && patch.originalPrice !== '') {
      const e = checkPrice(patch.originalPrice, '原价');
      if (e) return fail(e);
    }
    if (patch && patch.desc !== undefined && String(patch.desc).length > MAX_DESC_LEN) {
      return fail(`描述不能超过 ${MAX_DESC_LEN} 字`);
    }
    // 白名单不含 campus：商品归属学校跟随卖家资料，不允许通过编辑篡改
    const allow = ['title', 'desc', 'price', 'originalPrice', 'category', 'condition', 'pickupPoint'];
    const data = { updatedAt: Date.now() };
    for (const k of allow) if (patch[k] !== undefined) data[k] = patch[k];
    await db.collection(COL_GOODS).doc(id).update({ data });
    _goodsListDirtyAt = Date.now(); // 改价/改分类等使列表缓存失效
    return ok({ updated: true });
  },

  async setStatus({ id, status }, openid) {
    // ⚠️ 卖家只能「上架 / 下架」。
    // reserved / sold 必须由订单流驱动（order.create 抢占 → reserved，order.complete → sold）；
    // 若允许卖家手改，可绕过 order.complete 把商品置 sold，导致商品状态与 soldCount 统计脱节
    //（商品显示已售出，但卖家成交数没 +1）。前端也只传 onSale / off。
    if (!['onSale', 'off'].includes(status)) return fail('非法状态：卖家仅可上架或下架');
    const g = await db.collection(COL_GOODS).doc(id).get();
    if (!g.data) return fail('商品不存在', 404);
    if (g.data._openid !== openid) return fail('无权操作', 403);
    const now = Date.now();
    const data = { status, updatedAt: now };
    if (status === 'off') {
      // 卖家自主下架：**不删除记录**（商品始终保留、可被后台查询检索），标记 offType='self'；
      // 自主下架无需二次审核（recheck=false），只有管理员/举报/违规导致的移除才进二次审核队列。
      data.offType = 'self';
      data.offReason = '卖家自主下架';
      data.offAt = now;
      data.recheck = false;
    } else if (status === 'onSale') {
      // 卖家（或被允许者）重新上架：清掉下架标记；历史操作仍留在 admin_logs 审计里
      data.offType = _.remove();
      data.offReason = _.remove();
      data.recheck = false;
    }
    await db.collection(COL_GOODS).doc(id).update({ data });
    _goodsListDirtyAt = Date.now(); // 上架/下架使列表缓存失效
    return ok({ ok: true });
  },

  /**
   * 供 admin 云函数跨函数调用：使首页/列表服务端缓存立即失效。
   * 管理员「下架 / 上架 / 禁售 / 二次审核」后调用一次，保证首页商品列表快速刷新
   * （list 在写入后的 TTL 窗口内跳过缓存，不再被旧的 10s 结果挡住）。
   */
  async markDirty(_event, openid) {
    // 安全：**客户端调用一律携带 OPENID**，跨函数内部调用（admin → goods）不带 OPENID。
    // 因此「有 OPENID 就要求管理员」即可挡住客户端滥用 ——
    // 不加校验时，任何人调 `goods action=markDirty` 都能把首页列表缓存置脏、强制回源（低强度 DoS）。
    if (openid) {
      const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
      if (!u.data || !u.data[0] || !u.data[0].isAdmin) return fail('无权限', 403);
    }
    _goodsListDirtyAt = Date.now();
    return ok({ ok: true });
  },

  async remove({ id }, openid) {
    const g = await db.collection(COL_GOODS).doc(id).get();
    if (!g.data) return fail('商品不存在', 404);
    if (g.data._openid !== openid) return fail('无权操作', 403);
    await db.collection(COL_GOODS).doc(id).remove();
    _goodsListDirtyAt = Date.now(); // 删除使列表缓存失效
    return ok({ removed: true });
  },

  /**
   * 异步图片内容安全检测（定时触发器调用）
   * - 扫所有 imgCheckStatus='pending' 且 status='onSale' 的商品（最多 10 条/次，避免超时）
   * - 对每条调 seccheck image
   *  - 通过：imgCheckStatus='safe'
   *  - 违规：imgCheckStatus='risky' 且 status='banned'（自然从首页/列表过滤掉）
   *  - 检测失败/超时：保持 'pending'，下次定时再扫
   * 限制：单次最多 10 条，防止定时器在 3s 内跑不完再次被 -504003。
   */
  async pendingImgCheck() {
    const res = await db.collection(COL_GOODS)
      .where({ imgCheckStatus: 'pending', status: 'onSale' })
      .limit(10)
      .field({ _id: true, cover: true, checkRetries: true })
      .get();
    const list = (res && res.data) || [];
    // 重试上限：同一张图连测 3 次仍失败（多半是 seccheck 自身超时/文件已删），
    // 不再无限重试占着队列，标 'safe' 放行（内容安全能力本就未开通时也是放行）
    const MAX_RETRY = 3;
    let safe = 0, risky = 0, err = 0, gaveUp = 0;
    for (const g of list) {
      if (!g.cover) {
        await db.collection(COL_GOODS).doc(g._id).update({ data: { imgCheckStatus: 'safe' } });
        safe++; continue;
      }
      try {
        const r = await cloud.callFunction({ name: 'seccheck', data: { action: 'image', fileID: g.cover } });
        const isRisky = r && r.result && r.result.data && r.result.data.risky;
        if (isRisky) {
          const t = Date.now();
          // 图片违规自动禁售：不删除记录，标记 offType='imgRisk' 并进入二次审核队列
          await db.collection(COL_GOODS).doc(g._id).update({
            data: {
              imgCheckStatus: 'risky', status: 'banned',
              offType: 'imgRisk', banReason: '图片内容违规（自动检测）',
              bannedAt: t, recheck: true, recheckAt: t, updatedAt: t
            }
          });
          _goodsListDirtyAt = Date.now(); // 自动禁售 → 首页缓存失效，快速同步
          risky++;
        } else {
          await db.collection(COL_GOODS).doc(g._id).update({ data: { imgCheckStatus: 'safe' } });
          safe++;
        }
      } catch (e) {
        console.error('pendingImgCheck item fail', g._id, e && e.message);
        const n = (g.checkRetries || 0) + 1;
        if (n >= MAX_RETRY) {
          await db.collection(COL_GOODS).doc(g._id).update({ data: { imgCheckStatus: 'safe', checkRetries: n } });
          gaveUp++;
        } else {
          await db.collection(COL_GOODS).doc(g._id).update({ data: { checkRetries: n } });
          err++;
        }
      }
    }
    return ok({ scanned: list.length, safe, risky, err, gaveUp });
  },

  async adminOff({ id, reason }, openid) {
    const u = await db.collection(COL_USER).where({ _openid: openid }).limit(1).get();
    if (!u.data || !u.data[0] || !u.data[0].isAdmin) return fail('无权限', 403);
    const now = Date.now();
    await db.collection(COL_GOODS).doc(id).update({
      data: {
        status: 'off', offType: 'admin', offReason: reason || '管理员下架',
        offAt: now, offBy: openid, recheck: true, recheckAt: now, updatedAt: now
      }
    });
    _goodsListDirtyAt = Date.now();
    return ok({ ok: true });
  }
};

exports.main = async (event = {}) => {
  // 定时触发器事件（结构：{ Type: 'timer', TriggerName, Time }），无 openid，走专门通道
  if (event && event.Type === 'timer') {
    try { return await handlers.pendingImgCheck(); }
    catch (e) { console.error('timer pendingImgCheck', e); return fail(e.message || 'timer fail', 500); }
  }
  const WX = cloud.getWXContext();
  // openid 作为局部变量逐层传参，避免模块级变量在并发请求间互相覆盖
  const openid = WX.OPENID || WX.openid || '';
  if (!openid) return fail('无法识别用户身份', 401);
  // 内部动作禁止客户端直接调用：pendingImgCheck 只允许定时触发器（入口见上方 event.Type==='timer'），
  // 否则任意登录用户都能空烧 seccheck 配额。
  if (event.action === 'pendingImgCheck') return fail('禁止直接调用', 403);
  const fn = handlers[event.action];
  if (!fn) return fail('未知 action: ' + event.action);
  try { return await fn(event, openid); }
  catch (e) { console.error(event.action, e); return fail(e.message || '服务器错误', 500); }
};
