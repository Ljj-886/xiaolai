const { call } = require('../../utils/cloud.js');
const { fromNow, debounce, STATUS_GOODS, formatTime, cleanReason } = require('../../utils/util.js');
const { catName } = require('../../utils/categories.js');

const TABS = [
  { key: 'pending', name: '待审核' },
  { key: 'recheck', name: '待二次审核' },
  { key: 'onSale', name: '在售' },
  { key: 'off', name: '已下架' },
  { key: 'banned', name: '禁售' },
  { key: 'sold', name: '已售' },
  { key: 'all', name: '全部' }
];

// 下架/禁售来源（保留可查的语义标签）：管理员据此判断是否重新上架
const OFF_TYPE = {
  self: '卖家自主下架',
  report: '举报下架',
  admin: '管理员下架',
  ban: '管理员禁售',
  imgRisk: '图片违规',
  reviewReject: '审核驳回'
};

// 图片内容安全检测状态（判断「为何无法上架」的关键依据之一）
const IMG_CHECK = {
  safe: null,                              // 安全 → 不展示，避免噪音
  pending: { text: '图片待检测', cls: 'tag-warn' },
  risky: { text: '图片违规', cls: 'tag-danger' }
};

/** 时间格式化：管理后台需要精确到分钟（相对时间不足以判断「多久前操作的」）。
 *  统一复用 utils/util.js 的 formatTime（此前三个后台页各写了一份相同实现）。*/
const fmtTime = formatTime;

function decorate(g) {
  const s = STATUS_GOODS[g.status] || null;
  const isWant = g.type === 'want';
  const img = IMG_CHECK[g.imgCheckStatus] || null;

  // —— 无法上架原因：把「谁在何时以什么理由做了什么」拼成一句可读的话 ——
  // 优先级：禁售原因 > 下架原因 > 审核驳回原因
  const reason = cleanReason(g.banReason) || cleanReason(g.offReason) || '';
  const opName = g.offByName || g.bannedByName || '';
  const opAt = g.bannedAt || g.offAt || 0;
  let auditText = '';
  if (reason || opName || opAt) {
    const parts = [];
    if (opName) parts.push(opName);
    if (opAt) parts.push(fmtTime(opAt));
    auditText = parts.join(' · ');
  }

  // 无 offType 的「已下架」老数据：给出兜底来源，避免审核人员看到空白来源无法判断
  const offTypeText = OFF_TYPE[g.offType] ||
    (g.status === 'off' ? '已下架（历史数据）' : g.status === 'banned' ? '管理员禁售' : '');

  return {
    ...g,
    isWant,
    // 分类中文名：后台拿到的 category 是英文 key，审核人员看 `digital` 无法判断品类
    categoryText: g.categoryText || catName(g.category),
    // 卖家头像：无 / 失效 → 默认头像（后台头像裂图会显得"数据坏了"）
    sellerAvatar: (g.seller && g.seller.avatarUrl) || '/images/avatar-default.png',
    createdAtText: fromNow(g.createdAt),
    createdAtFull: fmtTime(g.createdAt),
    // 后台沿用「待审核」措辞（与 tab 名一致），不用 STATUS_GOODS 里的「审核中」
    statusText: g.status === 'pending' ? '待审核' : ((s && s.text) || g.status),
    statusCls: (s && s.cls) || (g.status === 'pending' ? 'tag-warn' : 'tag-gray'),
    offTypeText,
    // 展示优先用禁售原因，其次下架原因（已清洗占位文案）
    reasonText: reason,
    // 操作人 + 操作时间（谁在何时操作的，一眼可辨）
    auditText,
    // 二次审核轨迹
    recheckAtText: g.recheckAt ? fmtTime(g.recheckAt) : '',
    recheckedAtText: g.recheckedAt ? fmtTime(g.recheckedAt) : '',
    recheckDecisionText: ({
      onSale: '复核决定：重新上架',
      off: '复核决定：维持下架',
      banned: '复核决定：改判禁售'
    })[g.recheckDecision] || '',
    // 图片检测
    imgCheckText: img ? img.text : '',
    imgCheckCls: img ? img.cls : ''
  };
}

Page({
  data: {
    tabs: TABS,
    active: 'pending',
    keyword: '',
    list: [],
    loading: false,
    page: 1,
    hasMore: true
  },

  onLoad(options) {
    this._debouncedSearch = debounce(() => this.reload(), 400);
    const tab = options && options.tab;
    if (tab && TABS.some(t => t.key === tab)) this.setData({ active: tab });
  },

  onShow() { this.reload(); },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.active) return;
    this.setData({ active: tab });
    this.reload();
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value || '' });
    this._debouncedSearch();
  },

  clearKeyword() {
    this.setData({ keyword: '' });
    this.reload();
  },

  reload() {
    this.setData({ page: 1, list: [], hasMore: true });
    this.loadMore();
  },

  /**
   * 管理动作成功后：写首页脏标记。回到首页（onShow）时会跳过 60s 节流强制重拉，
   * 配合服务端 goods.markDirty 让首页商品列表「快速、无明显延迟」地展示最新状态。
   */
  bumpHome() {
    try { wx.setStorageSync('cm_home_dirty', Date.now()); } catch (e) {}
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    this.setData({ loading: true });
    try {
      const r = await call('admin', {
        action: 'listGoods',
        status: this.data.active,
        keyword: this.data.keyword,
        page: this.data.page,
        pageSize: 20
      }, { silent: true, loading: false });
      const list = (r.list || []).map(decorate);
      this.setData({
        list: this.data.page === 1 ? list : this.data.list.concat(list),
        hasMore: !!r.hasMore,
        page: this.data.page + 1
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() { this.loadMore(); },

  /** 点击商品项 → 跳转与首页点击完全一致的商品详情页 */
  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /** 卖家头像加载失败 → 换默认头像（必须改地址，否则会永久空白） */
  onAvatarErr(e) {
    const id = e.currentTarget.dataset.id;
    const idx = this.data.list.findIndex(g => g._id === id);
    if (idx === -1) return;
    const cur = this.data.list[idx].sellerAvatar;
    if (cur === '/images/avatar-default.png') return;
    this.setData({ [`list[${idx}].sellerAvatar`]: '/images/avatar-default.png' });
  },

  preview(e) {
    const { urls, current } = e.currentTarget.dataset;
    if (urls && urls.length) wx.previewImage({ urls, current });
  },

  async pass(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认上架',
      content: '确认通过该商品审核并上架到首页吗？',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'reviewGoods', id, pass: true });
          wx.showToast({ title: '已上架' });
          this.bumpHome();
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  reject(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '驳回商品',
      content: '请填写驳回原因（用户将在商品页看到）：',
      editable: true,
      placeholderText: '如：图片/描述不符合规范',
      success: async r => {
        if (!r.confirm) return;
        const reason = (r.content || '').trim();
        if (!reason) { wx.showToast({ title: '请填写驳回原因', icon: 'none' }); return; }
        try {
          await call('admin', { action: 'reviewGoods', id, pass: false, reason });
          wx.showToast({ title: '已驳回' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  off(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find(g => g._id === id);
    if (item && item.status === 'sold') {
      wx.showToast({ title: '已出售商品无法下架', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '下架商品',
      content: '下架后商品从首页移除（记录保留、可查询检索）。请填写下架原因：',
      editable: true,
      placeholderText: '如：违规 / 已售出',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'adminOff', id, reason: (r.content || '').trim() });
          wx.showToast({ title: '已下架' });
          this.bumpHome();
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  /** 禁售：商品不删除，标记 banned 并进入二次审核队列 */
  ban(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '禁售商品',
      content: '禁售后商品从首页移除（记录保留、可查询）。请填写禁售原因：',
      editable: true,
      placeholderText: '如：违禁品 / 多次违规',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'banGoods', id, reason: (r.content || '').trim() });
          wx.showToast({ title: '已禁售' });
          this.bumpHome();
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  /** 二次审核 / 恢复：重新上架 */
  restore(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '重新上架',
      content: '确认将该商品重新上架到首页吗？（记录保留，操作写入审计日志）',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'recheckGoods', id, decision: 'onSale' });
          wx.showToast({ title: '已重新上架' });
          this.bumpHome();
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  /** 二次审核：维持下架 */
  keepOff(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '维持下架',
      content: '请填写复核备注（选填，仅管理员可见）：',
      editable: true,
      placeholderText: '如：核实违规属实，维持下架',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'recheckGoods', id, decision: 'off', note: (r.content || '').trim() });
          wx.showToast({ title: '已处理' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  /** 二次审核：改判禁售 */
  recheckBan(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '改判禁售',
      content: '请填写禁售原因（选填）：',
      editable: true,
      placeholderText: '如：二次核实违规，禁售',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'recheckGoods', id, decision: 'banned', note: (r.content || '').trim() });
          wx.showToast({ title: '已禁售' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  }
});
