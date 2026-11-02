const { call } = require('../../utils/cloud.js');
const { fromNow, cleanReason } = require('../../utils/util.js');
// 分类选项统一由 utils/categories.js 提供（catOptions 已含「全部」项）。
// 分类必须与后端口径一致：goods 表按 key 存储并匹配，
// 这里若用中文名（历史写法）会导致筛选永远返回空列表。
const { catOptions } = require('../../utils/categories.js');

const CATS = catOptions();

// 下架/禁售来源 → 给卖家看的可读文案。
// 卖家必须知道「为什么被下架」，否则会反复重新上架、反复被下架。
const OFF_TYPE_SELF = {
  report: '举报下架',
  admin: '管理员下架',
  ban: '管理员禁售',
  imgRisk: '图片违规',
  reviewReject: '审核未通过'
};

/** 清洗原因文案统一走 utils/util.js 的 cleanReason（原先三页各抄一份） */

/** 为「我的商品」补充下架/禁售原因（仅自己视图展示） */
function decorateReason(g) {
  const isBanned = g.status === 'banned';
  const reason = cleanReason(isBanned ? (g.banReason || g.offReason) : g.offReason);
  // 卖家自主下架没有"原因"可讲，不展示（避免"卖家自主下架"这种废话刷屏）
  const showIt = reason && g.offType && g.offType !== 'self';
  return {
    ...g,
    reasonText: showIt ? reason : '',
    reasonLabel: isBanned ? '禁售原因' : (OFF_TYPE_SELF[g.offType] || '下架原因')
  };
}

Page({
  data: {
    tabs: [
      { key: 'onSale', label: '在售' },
      { key: 'sold', label: '已售' },
      { key: 'off', label: '已下架' }
    ],
    categories: CATS,
    current: 'onSale',
    cat: '',
    list: [], loadError: '', page: 1, pageSize: 20, hasMore: true, loading: false,
    seller: null,
    defaultAvatar: '/images/avatar-default.png',
    // 卖家头像加载失败兜底（他人主页 banner 头像）
    sellerAvatarErr: false,
    // 是否「自己的主页」：onLoad 时根据 opt.openid 判断，传了 openid 就是别人的主页
    isSelf: true,
    sellerOpenid: '',
    type: '', // 非空时为「求购」视图（我的求购 / 他人求购）
    isWant: false,
    navTitle: '个人主页'
  },

  onLoad(opt = {}) {
    this.sellerOpenid = opt.openid || '';
    const initStatus = opt.status || 'onSale';
    const isWant = opt.type === 'want';
    // 新发布的商品先进「待审核」（status='pending'），既不在首页（只显示 onSale），
    // 原先也不在任何 tab 里 —— 用户发布后会发现"哪里都找不到"，以为没保存。
    // 为自己视图补一个「审核中」tab（看他人主页时不加）。
    const selfOnly = this.sellerOpenid ? [] : [{ key: 'pending', label: '审核中' }];
    const tail = isWant
      ? [{ key: 'sold', label: '已达成' }, { key: 'off', label: '已关闭' }]
      : [{ key: 'sold', label: '已售' }, { key: 'off', label: '已下架' }];
    // 「禁售」只在自己视图展示：管理员强制停售的商品**记录保留**，卖家能看到状态与原因
    if (!this.sellerOpenid) tail.push({ key: 'banned', label: '禁售' });
    const head = isWant ? [{ key: 'onSale', label: '募集中' }] : [{ key: 'onSale', label: '在售' }];
    const tabs = head.concat(selfOnly, tail);
    // 同步到 data，wxml 用 data 字段判断
    const navTitle = isWant && !this.sellerOpenid ? '我的求购'
      : (!this.sellerOpenid ? '我的商品' : '个人主页');
    this.setData({ current: initStatus, sellerOpenid: this.sellerOpenid, isSelf: !this.sellerOpenid, type: opt.type || '', isWant, tabs, navTitle });
    // 动态标题：自己看是「我的商品」，看他人是对方的昵称
    if (!this.sellerOpenid) {
      wx.setNavigationBarTitle({ title: navTitle });
    }
  },

  onShow() {
    // 兜底：页面栈复用时如果 sellerOpenid 变了，重新对齐
    this.setData({ isSelf: !this.sellerOpenid });
    this.fetch(true);
    this.loadSeller();
  },

  onPullDownRefresh() {
    this.fetch(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.fetch(); },
  loadMore() { this.fetch(); },

  async loadSeller() {
    if (!this.sellerOpenid) {
      // 自己：用 user/me 拿自己的公开信息
      try {
        const me = await call('user', { action: 'me' }, { silent: true, loading: false });
        // 构造同构 seller
        // WXML 不能调用 JS 函数（setData 会丢弃函数），时间在这里格式化好
        this.setData({
          seller: {
            _openid: me._openid,
            nickName: me.nickName, avatarUrl: me.avatarUrl,
            school: me.school, verified: me.verified,
            credit: me.credit == null ? 100 : me.credit,
            createdAt: me.createdAt,
            createdAtText: fromNow(me.createdAt),
            onSaleCount: me.onSaleCount || 0,
            soldCount: me.soldCount || 0
          }
        });
        wx.setNavigationBarTitle({ title: (me.nickName || '我') + '的主页' });
      } catch (e) {}
      return;
    }
    try {
      const r = await call('user', { action: 'getPublic', openid: this.sellerOpenid }, { silent: true, loading: false });
      this.setData({ seller: { ...r, createdAtText: fromNow(r.createdAt) } });
      wx.setNavigationBarTitle({ title: (r.nickName || '同学') + '的主页' });
    } catch (e) {}
  },

  setTab(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ current: key, cat: '' }, () => this.fetch(true));
  },

  pickCat(e) {
    const c = e.currentTarget.dataset.c;
    this.setData({ cat: c }, () => this.fetch(true));
  },

  async fetch(reset = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      let r;
      const status = this.data.current;
      const category = this.data.cat || '';
      if (this.sellerOpenid) {
        // 公开主页：用 goods.list 按卖家+状态+分类筛
        r = await call('goods', {
          action: 'list', page, pageSize: this.data.pageSize,
          sort: 'new', status, category, _openid: this.sellerOpenid, type: this.data.type
        }, { silent: true, loading: false });
      } else {
        r = await call('user', {
          action: 'myGoods', page, pageSize: this.data.pageSize,
          status, category, type: this.data.type
        }, { silent: true, loading: false });
      }
      const incoming = (r.list || []).map(decorateReason);
      const list = reset ? incoming : this.data.list.concat(incoming);
      this.setData({ list, hasMore: r.hasMore, page: page + 1, loadError: '' });
    } catch (e) {
      // 不再静默吞异常：失败若显示成「还没有商品」会让卖家以为商品被删了
      console.error('商品列表加载失败', e);
      if (reset && !this.data.list.length) {
        this.setData({ loadError: (e && e.msg) || '加载失败，请重试' });
      }
    }
    this.setData({ loading: false });
  },

  /** 加载失败后点「重试」 */
  retry() {
    this.setData({ loadError: '' });
    this.fetch(true);
  },

  /** 卖家头像加载失败 → 回退默认头像（必须同时改 src，否则永久空白） */
  onSellerAvatarErr() {
    if (this.data.sellerAvatarErr) return;
    this.setData({ sellerAvatarErr: true });
  },

  goDetail(e) {
    const { id } = e.detail || {};
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goPublish() { wx.switchTab({ url: '/pages/publish/publish' }); },

  goReport() {
    if (this.data.isSelf || !this.sellerOpenid) return;
    wx.navigateTo({ url: `/pages/report/report?targetType=user&targetId=${this.sellerOpenid}` });
  },

  async setStatus(id, status, tip) {
    try {
      await call('goods', { action: 'setStatus', id, status });
      wx.setStorageSync('cm_home_dirty', Date.now()); // 上/下架后首页强制刷新
      wx.showToast({ title: tip, icon: 'success' });
      this.fetch(true);
    } catch (e) {}
  },
  offGoods(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '下架商品', content: '下架后商品将不再展示，可随时重新上架',
      success: r => { if (r.confirm) this.setStatus(id, 'off', '已下架'); }
    });
  },
  onGoods(e) {
    this.setStatus(e.currentTarget.dataset.id, 'onSale', '已重新上架');
  },
  goEdit(e) {
    wx.setStorageSync('cm_edit_goods_id', e.currentTarget.dataset.id);
    wx.reLaunch({ url: '/pages/publish/publish' });
  }
});