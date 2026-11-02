// utils/categories.js
// 分类体系的**唯一数据源**。
//
// 背景：此前分类的 key / 中文名 / 图标 / 图标文件映射散落在 7 个文件里：
//   - utils/constants.js    CATEGORIES 数组（key + name + icon emoji）
//   - utils/icon.wxs        WXS 里又硬编码了一份 key → 图标文件名的表
//   - pages/category/category.js / order.js / order-detail.js / sold.js
//                           各写一遍 CATEGORIES.find(c => c.key === key).name
//   - pages/detail/detail.wxml、pages/admin-goods/admin-goods.wxml
//                           干脆没有映射，直接把 category 字段（英文 key）渲染给用户
// 后果：新增/改一个分类要改 7 处；漏改的地方就把 `book`、`digital` 这种英文 key
// 直接显示给用户（详情页、后台商品页实测存在）。
//
// 现在统一到这里：**任何需要 key ↔ 中文名 ↔ 图标 的地方，一律 require 本文件。**
// WXS（wxml 内联表达式）无法 require JS 模块，因此在 utils/icon.wxs 里保留一份
// 与 ICON_FILE 对齐的只读副本；两侧由 scripts/check-category-sync.js 做一致性校验。

/** 分类定义表。order 即展示顺序，新增分类只改这一处。
 *  `bg` = 左侧栏该分类图标的气泡底色，按图标 PNG 实测主色后选定：
 *   - 所有图标都有深色描边 #302010；浅色 pastel 已与描边强对比。
 *   - 每行注释标注图标填充色，bg 刻意避开该填充色，避免图标被背景淹没。
 */
const CATEGORIES = [
  { key: 'book',    name: '教材书籍', icon: '📚', bg: '#FFE5D6' }, // 填充绿+蓝 → 暖桃色
  { key: 'digital', name: '数码电子', icon: '💻', bg: '#FFD6E0' }, // 填充青蓝 → 柔粉色
  { key: 'dorm',    name: '宿舍神器', icon: '🛏️', bg: '#CFE8FF' }, // 填充桃/橙 → 天空蓝
  { key: 'clothes', name: '服饰鞋包', icon: '👕', bg: '#E9DDFF' }, // 填充绿 → 薰衣草紫
  { key: 'sports',  name: '运动户外', icon: '🏀', bg: '#D9F2E5' }, // 填充橙 → 薄荷绿
  { key: 'beauty',  name: '美妆护肤', icon: '💄', bg: '#C9EFE8' }, // 填充粉 → 水鸭青
  { key: 'bike',    name: '代步出行', icon: '🚲', bg: '#FFF3C2' }, // 全深色 → 柠檬黄
  { key: 'ticket',  name: '票券卡券', icon: '🎫', bg: '#D6E4FF' }, // 填充金黄 → 长春花蓝
  { key: 'life',    name: '生活日用', icon: '🧴', bg: '#FFF8D6' }, // 填充青绿 → 奶油黄
  { key: 'other',   name: '其他闲置', icon: '📦', bg: '#E8F5C6' }  // 填充棕/橙 → 嫩绿
];

/**
 * key → 卡通图标文件名（不含路径与扩展名）。
 * 与 utils/icon.wxs 里的 CAT 表必须保持一致，改这里记得同步。
 */
const ICON_FILE = {
  book: 'cat_book',
  digital: 'cat_digital',
  dorm: 'cat_dorm',
  clothes: 'cat_clothes',
  sports: 'cat_sports',
  beauty: 'cat_beauty',
  bike: 'cat_bike',
  ticket: 'cat_ticket',
  life: 'cat_life',
  other: 'cat_other'
};

/** 非法 key 的兜底分类 */
const FALLBACK_KEY = 'other';

/** 快速索引：key → 分类定义 */
const BY_KEY = CATEGORIES.reduce((m, c) => { m[c.key] = c; return m; }, {});

/** 全部合法 key（用于服务端校验入库分类是否合法） */
const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

/**
 * 该 key 是否为合法分类。
 * 注意：空串 '' 表示「全部分类」，**不视为合法分类 key**，发布/编辑商品时必须传真实 key。
 */
function isCatKey(key) {
  return !!key && Object.prototype.hasOwnProperty.call(BY_KEY, key);
}

/**
 * key → 中文名。
 * 历史脏数据（写入了中文名本身、或写入了未知 key）都能尽量给出可读结果：
 *   1) 命中映射 → 返回标准中文名（`book` → `教材书籍`）
 *   2) 传入的本身就是某个中文名 → 原样返回（兼容早期把中文名写进 category 的商品）
 *   3) 未知 key → 原样返回（比显示「未知分类」更利于排查），但空值返回 ''
 */
function catName(key) {
  if (key === null || key === undefined) return '';
  const k = String(key);
  if (!k) return '';
  const hit = BY_KEY[k];
  if (hit) return hit.name;
  // 兼容：传入的已经是中文名
  const byName = CATEGORIES.find(c => c.name === k);
  if (byName) return byName.name;
  return k;
}

/** key → 图标图片路径（供 JS 侧使用；wxml 内用 utils/icon.wxs 的 ico.cat） */
function catIcon(key) {
  const file = ICON_FILE[isCatKey(key) ? key : FALLBACK_KEY] || ICON_FILE[FALLBACK_KEY];
  return '/images/' + file + '.png';
}

/** key → emoji 图标（constants 里那份，用于纯文本场景） */
function catEmoji(key) {
  const hit = BY_KEY[isCatKey(key) ? key : FALLBACK_KEY];
  return (hit && hit.icon) || '📦';
}

/** key → 分类定义对象（非法 key 兜底到「其他闲置」，不会返回 undefined） */
function catOf(key) {
  return BY_KEY[isCatKey(key) ? key : FALLBACK_KEY];
}

/** 带「全部」选项的分类列表（筛选条常用）：[{ key:'', name:'全部' }, ...] */
function catOptions(allLabel = '全部') {
  return [{ key: '', name: allLabel, icon: '🔍' }].concat(CATEGORIES);
}

module.exports = {
  CATEGORIES,
  CATEGORY_KEYS,
  ICON_FILE,
  FALLBACK_KEY,
  isCatKey,
  catName,
  catIcon,
  catEmoji,
  catOf,
  catOptions
};
