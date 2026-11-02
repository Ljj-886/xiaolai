const { call } = require('../../utils/cloud.js');
const app = getApp();
const { CATEGORIES } = require('../../utils/constants.js');

Page({
  data: {
    cats: CATEGORIES,
    current: '',
    name: '全部',
    sort: 'new',
    list: [],
    loadError: '',
    page: 1, pageSize: 20, hasMore: true, loading: false
  },

  onLoad(opt = {}) {
    // URL 直跳（非 tabBar 方式进入，如分享链接）
    if (opt.key !== undefined) {
      const name = opt.name || (CATEGORIES.find(c => c.key === opt.key) || {}).name || '全部';
      wx.setNavigationBarTitle({ title: name });
      this.setData({ current: opt.key || '', name });
      this.fetchList(true);
    }
    // tabBar 跳转的情况由 onShow 处理
  },

  onShow() {
    app.syncTabBar(1); // 同步自定义 tabBar 的选中态
    // switchTab 不会重新触发 onLoad，每次进入 tab 都要检查首页写入的分类参数
    const cached = wx.getStorageSync('cm_cat_filter');
    if (cached && cached.key !== undefined) {
      wx.removeStorageSync('cm_cat_filter');
      if (cached.key !== this.data.current || cached.name !== this.data.name) {
        wx.setNavigationBarTitle({ title: cached.name || '全部' });
        this.setData({ current: cached.key, name: cached.name || '全部' });
      }
      // 即使分类没变也要刷新，否则跳「全部商品」时列表不会更新
      this.fetchList(true);
      return;
    }
    // 首次进入 tab（没有任何分类参数）也要加载，否则列表永远是空的
    if (!this._loaded) {
      this._loaded = true;
      this.fetchList(true);
    }
  },

  onPullDownRefresh() {
    this.fetchList(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.fetchList(); },
  loadMore() { this.fetchList(); },

  selectCat(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.current) return;
    const name = (CATEGORIES.find(c => c.key === key) || {}).name || '全部';
    wx.setNavigationBarTitle({ title: name });
    this.setData({ current: key, name }, () => this.fetchList(true));
  },

  setSort(e) {
    const sort = e.currentTarget.dataset.sort;
    if (sort === this.data.sort) return;
    this.setData({ sort }, () => this.fetchList(true));
  },

  async fetchList(reset = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      const data = await call('goods', {
        action: 'list', page, pageSize: this.data.pageSize,
        category: this.data.current, sort: this.data.sort
      }, { silent: true });
      const list = reset ? data.list : this.data.list.concat(data.list);
      this.setData({ list, hasMore: data.hasMore, page: page + 1, loadError: '' });
    } catch (e) {
      // 之前这里静默吞异常，后端 500 时页面显示「该分类暂无商品」——
      // 用户会以为真的没货，实际是请求失败且没有重试入口。改为显式报错 + 可重试。
      console.error('分类商品加载失败', e);
      if (reset && !this.data.list.length) {
        this.setData({ loadError: (e && e.msg) || '加载失败，请重试' });
      }
    }
    this.setData({ loading: false });
  },

  /** 加载失败后点「重试」 */
  retry() {
    this.setData({ loadError: '' });
    this.fetchList(true);
  },

  goDetail(e) {
    const { id } = e.detail || {};
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});
