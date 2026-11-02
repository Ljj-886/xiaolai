// utils/util.js
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromNow(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + '天前';
  return formatTime(ts).slice(0, 10);
}

function fmtPrice(p) {
  if (p === null || p === undefined) return '';
  return Number(p).toFixed(2);
}

function debounce(fn, wait = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function genOrderNo() {
  const d = new Date();
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return stamp + Math.floor(Math.random() * 9000 + 1000);
}

/**
 * 清洗「下架/禁售原因」文案。
 * 历史脏数据里混入过表单占位语（如「请填写下架原因（选填，留空则仅下架）：」），
 * 这类文案展示给卖家/审核人员毫无意义，一律视为「未填写原因」。
 * 原先 detail / sold / admin-goods 三页各抄了一份，规则容易漂移，统一到这里。
 */
function cleanReason(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (/^请填写|^请输入|^填写下架原因|选填|留空则/.test(t)) return '';
  if (t.length > 60) return ''; // 异常长文本多半是误粘贴
  return t;
}

const CONDITION_MAP = {
  new: '全新',
  likeNew: '几乎全新',
  slight: '轻微使用',
  normal: '正常使用',
  worn: '明显使用'
};
function condText(v) { return CONDITION_MAP[v] || v || ''; }

const STATUS_GOODS = {
  onSale: { text: '在售', cls: 'tag-success' },
  // 新发布的商品先进「待审核」，审核通过才转 onSale。
  // 此前这里缺 pending 映射 → 卡片角标渲染成空白，用户看不出商品处于什么状态。
  pending: { text: '审核中', cls: 'tag-warn' },
  reserved: { text: '已预订', cls: 'tag-warn' },
  sold: { text: '已售出', cls: 'tag-gray' },
  off: { text: '已下架', cls: 'tag-gray' },
  // 禁售：管理员/违规导致的强制停售（区别于卖家自主下架 off）。记录保留、可查询。
  banned: { text: '禁售', cls: 'tag-danger' }
};

// 求购专用状态文案：求购没有「售出/下架」语义，对应为「已达成 / 已关闭」。
// 卡片与详情页按 item.type==='want' 选这张表，避免求购显示成「已售出」。
const STATUS_WANT = {
  onSale: { text: '募集中', cls: 'tag-success' },
  pending: { text: '审核中', cls: 'tag-warn' },
  reserved: { text: '进行中', cls: 'tag-warn' },
  sold: { text: '已达成', cls: 'tag-gray' },
  off: { text: '已关闭', cls: 'tag-gray' },
  banned: { text: '已下架', cls: 'tag-danger' }
};

/** 按商品类型取状态文案：求购用 STATUS_WANT，其余用 STATUS_GOODS */
function goodsStatusText(item) {
  const it = item || {};
  const s = (it.type === 'want' ? STATUS_WANT : STATUS_GOODS)[it.status || 'onSale'];
  return s || STATUS_GOODS.onSale;
}

const STATUS_ORDER = {
  pending: { text: '待确认', cls: 'tag-warn' },
  meeting: { text: '待见面', cls: 'tag' },
  paid: { text: '已付款', cls: 'tag-success' },
  completed: { text: '已完成', cls: 'tag-success' },
  cancelled: { text: '已取消', cls: 'tag-gray' },
  refunding: { text: '退款中', cls: 'tag-warn' }
};

module.exports = {
  formatTime, fromNow, fmtPrice, debounce, genOrderNo, condText, cleanReason,
  STATUS_GOODS, STATUS_WANT, STATUS_ORDER, goodsStatusText
};
