const { call } = require('../../utils/cloud.js');

Page({
  data: { list: [], loadError: '', page: 1, pageSize: 20, hasMore: true, loading: false },

  onShow() { this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.fetch(); },
  loadMore() { this.fetch(); },

  async fetch(reset = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      const r = await call('user', { action: 'myFavs', page, pageSize: this.data.pageSize }, { silent: true, loading: false });
      const list = reset ? r.list : this.data.list.concat(r.list);
      this.setData({ list, hasMore: r.hasMore, page: page + 1, loadError: '' });
    } catch (e) {
      // 不再静默吞异常：失败时若直接显示「还没有收藏」会误导用户以为收藏被清空
      console.error('收藏列表加载失败', e);
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

  goDetail(e) {
    const { id } = e.detail || {};
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /**
   * 快捷取消收藏：先本地移除（乐观更新，交互更跟手），失败再回滚。
   * 此前只能在商品详情页里取消，路径太长。
   */
  async unfav(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const backup = this.data.list.slice();
    this.setData({ list: this.data.list.filter(x => x._id !== id) });
    try {
      await call('user', { action: 'toggleFav', goodsId: id }, { silent: true, loading: false });
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } catch (err) {
      this.setData({ list: backup });
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); }
});
