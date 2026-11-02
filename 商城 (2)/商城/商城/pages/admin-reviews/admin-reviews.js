const { call } = require('../../utils/cloud.js');
const { fromNow, formatTime } = require('../../utils/util.js');

const TABS = [
  { key: 'verify', name: '认证' },
  { key: 'report', name: '举报' },
  { key: 'feedback', name: '反馈' }
];
const KIND = { suggest: '建议', bug: '问题', report: '举报', other: '其他' };
const REP_STATUS = {
  pending: { text: '待处理', cls: 'tag-warn' },
  resolved: { text: '已处理', cls: 'tag-success' },
  rejected: { text: '已驳回', cls: 'tag-danger' }
};
// 商品状态中文（含下架/禁售后状态，便于核实「举报后商品去向」）
const GOODS_STATUS = {
  onSale: '在售', sold: '已售出', reserved: '已预订', off: '已下架',
  pending: '待审核', banned: '禁售'
};
// 举报处理结论 → 可读文案
const HANDLE_RESULT = {
  off_goods: '已下架商品',
  ban_user: '已封禁用户',
  '已处理': '已处理（未处置商品）'
};
const FB_STATUS = {
  resolved: { text: '已处理', cls: 'tag-success' },
  rejected: { text: '已忽略', cls: 'tag-gray' },
  pending: { text: '待处理', cls: 'tag-warn' }
};

/** 时间格式化：处理轨迹需精确到分钟。统一复用 utils/util.js 的 formatTime */
const fmtTime = formatTime;

Page({
  data: {
    tabs: TABS,
    active: 'verify',
    archive: 'pending', // 举报/反馈的 待处理/已处理 切换
    list: [],
    loading: false,
    page: 1,
    hasMore: true,
    // 图片加载失败兜底：{ [key]: true } → 回退占位/隐藏
    imgErr: {},
    defaultCover: '/images/goods-cover-default.png'
  },

  /** 被举报商品封面加载失败 → 标记并回退占位图（临时链接 10 分钟过期会 403） */
  onCoverErr(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.imgErr[id]) return;
    this.setData({ ['imgErr.' + id]: true });
  },

  /** 认证材料图加载失败 → 标记（避免整块空白无从判断） */
  onEvidenceErr(e) {
    const url = e.currentTarget.dataset.url;
    if (!url || this.data.imgErr[url]) return;
    this.setData({ ['imgErr.' + url]: true });
  },

  onLoad(options) {
    const tab = options && options.tab;
    if (tab && TABS.some(t => t.key === tab)) this.setData({ active: tab });
  },

  onShow() { this.reload(); },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.active) return;
    this.setData({ active: tab, archive: 'pending' });
    this.reload();
  },

  switchArchive(e) {
    const a = e.currentTarget.dataset.archive;
    if (a === this.data.archive) return;
    this.setData({ archive: a });
    this.reload();
  },

  reload() {
    this.setData({ page: 1, list: [], hasMore: true });
    this.loadMore();
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    this.setData({ loading: true });
    try {
      const { active, archive, page } = this.data;
      let list = [], hasMore = false;
      if (active === 'verify') {
        const v = await call('user', { action: 'listPendingVerify' }, { silent: true, loading: false });
        list = (v.list || []).map(x => ({ ...x, applyCreatedAtText: fromNow((x.apply || {}).createdAt) }));
      } else if (active === 'report') {
        const status = archive === 'pending' ? 'pending' : 'all';
        const r = await call('admin', { action: 'pendingReports', status, page, pageSize: 20 }, { silent: true, loading: false });
        list = (r.list || []).map(x => {
          const s = REP_STATUS[x.status] || null;
          return {
            ...x,
            createdAtText: fromNow(x.createdAt),
            statusText: (s && s.text) || x.status,
            statusCls: (s && s.cls) || 'tag-gray',
            goodsStatusText: GOODS_STATUS[x.goodsStatus] || (x.goodsStatus || ''),
            // 处理轨迹：结论 + 补充备注 + 时间（管理员查历史时需要精确时间）
            handleResultText: HANDLE_RESULT[x.handleResult] || x.handleResult || '',
            handledAtText: x.handledAt ? fmtTime(x.handledAt) : '',
            // 是否可跳转被举报商品详情（商品已删除则不可点）
            canJumpGoods: x.targetType === 'goods' && !!x.targetId && !!x.goodsTitle
          };
        });
        hasMore = !!r.hasMore;
      } else {
        const status = archive === 'pending' ? 'pending' : 'all';
        const r = await call('feedback', { action: 'list', status, page, pageSize: 20 }, { silent: true, loading: false });
        list = (r.list || []).map(x => {
          const s = FB_STATUS[x.status] || null;
          return {
            ...x,
            images: x.images || [],
            createdAtText: fromNow(x.createdAt),
            handledAtText: x.handledAt ? fmtTime(x.handledAt) : '',
            kindName: KIND[x.kind] || '其他',
            statusText: (s && s.text) || x.status,
            statusCls: (s && s.cls) || 'tag-gray'
          };
        });
        hasMore = !!r.hasMore;
      }
      this.setData({
        list: page === 1 ? list : this.data.list.concat(list),
        hasMore,
        page: page + 1
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() { this.loadMore(); },

  previewEvidence(e) {
    const { urls, current } = e.currentTarget.dataset;
    if (urls && urls.length) wx.previewImage({ urls, current });
  },

  /** 点击被举报商品 → 跳转与首页一致的商品详情页（便于核实真实性） */
  goGoods(e) {
    const { id } = e.currentTarget.dataset;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /** 点击被举报用户 → 查看其公开主页 */
  goUser(e) {
    const { openid } = e.currentTarget.dataset;
    if (openid) wx.navigateTo({ url: `/pages/sold/sold?openid=${openid}` });
  },

  // —— 认证审核 ——
  reviewVerify(e) {
    const { openid, pass } = e.currentTarget.dataset;
    const isPass = pass === '1';
    wx.showModal({
      title: isPass ? '通过认证' : '驳回申请',
      content: isPass ? '确认通过该校学生的认证申请？' : '请填写驳回理由（学生可在认证页看到）：',
      editable: !isPass,
      placeholderText: '如：截图与填写信息不一致，请重新上传',
      success: async r => {
        if (!r.confirm) return;
        if (!isPass && !(r.content || '').trim()) { wx.showToast({ title: '请填写驳回理由', icon: 'none' }); return; }
        try {
          await call('user', { action: 'reviewVerify', targetOpenid: openid, pass: isPass, reason: isPass ? '' : (r.content || '').trim() });
          wx.showToast({ title: '已处理' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  // —— 举报处理 ——
  handleReport(e) {
    const { id, pass, action } = e.currentTarget.dataset;
    wx.showModal({
      title: pass === '1' ? '处理举报' : '忽略举报',
      content: '可填写处理备注（选填，仅管理员可见）',
      editable: true,
      placeholderText: '如：已下架商品并警告用户',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'handleReport', id, pass: pass === '1', handleAction: action, note: (r.content || '').trim() });
          // 举报下架会让商品进入「二次审核」并影响首页 → 标记首页脏数据，回去时快速刷新
          if (pass === '1' && action === 'off_goods') {
            try { wx.setStorageSync('cm_home_dirty', Date.now()); } catch (err) {}
          }
          wx.showToast({ title: '已处理' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  // —— 反馈处理 ——
  handleFeedback(e) {
    const { id, pass } = e.currentTarget.dataset;
    const status = pass === '1' ? 'resolved' : 'rejected';
    wx.showModal({
      title: pass === '1' ? '标记为已处理' : '忽略该反馈',
      content: '确认操作？处理后将从「待处理」移除，但仍可在「已处理」中查看。',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('feedback', { action: 'handle', id, status });
          wx.showToast({ title: '已处理' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  // —— 举报重新打开（取消驳回/重新处理）——
  reOpenReport(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '重新处理举报',
      content: '确认将该举报重新打开为「待处理」状态吗？',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'handleReport', id, status: 'pending' });
          wx.showToast({ title: '已重新打开' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  // —— 反馈二次处理（重新打开）——
  reOpenFeedback(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '二次处理',
      content: '确认将该反馈重新打开为「待处理」状态吗？',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('feedback', { action: 'handle', id, status: 'pending' });
          wx.showToast({ title: '已重新打开' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  }
});
