const { call } = require('../../utils/cloud.js');
const { debounce } = require('../../utils/util.js');
const { CATEGORIES, CONDITIONS } = require('../../utils/constants.js');

const SORTS = [
  { value: 'new', label: '最新' },
  { value: 'priceAsc', label: '价格↑' },
  { value: 'priceDesc', label: '价格↓' },
  { value: 'hot', label: '热门' }
];

Page({
  data: {
    kw: '',
    history: [],
    hotWords: ['考研资料', 'iPad', '自行车', '蓝牙耳机', '羽绒服', '宿舍台灯'],
    categories: [{ key: '', name: '全部' }, ...CATEGORIES],
    conditions: [{ value: '', label: '全部成色' }, ...CONDITIONS],
    sorts: SORTS,
    // 筛选条件（与 goods.list 后端参数对齐）
    category: '', condition: '', minPrice: '', maxPrice: '', sort: 'new',
    list: [],
    total: 0,
    loadError: '',
    page: 1, pageSize: 20, hasMore: true,
    loading: false, searched: false,
    autoFocus: true
  },

  onLoad() {
    const h = wx.getStorageSync('cm_search_history') || [];
    this.setData({ history: h });
  },

  onInput(e) { this.setData({ kw: e.detail.value }); },
  clear() { this.setData({ kw: '' }); },
  goBack() { wx.navigateBack(); },

  doSearch() {
    const kw = (this.data.kw || '').trim();
    if (!kw) return;
    this.triggerSearch();
  },

  quickSearch(e) {
    const kw = e.currentTarget.dataset.kw;
    this.setData({ kw });
    this.triggerSearch();
  },

  // 筛选条件变化：立即重新搜索（关键词可空，纯筛选浏览也支持）
  onCategory(e) { this.setData({ category: e.currentTarget.dataset.v }); this.triggerSearch(); },
  onCondition(e) { this.setData({ condition: e.currentTarget.dataset.v }); this.triggerSearch(); },
  onSort(e) { this.setData({ sort: e.currentTarget.dataset.v }); this.triggerSearch(); },
  onMinPrice(e) { this.setData({ minPrice: e.detail.value }); },
  onMaxPrice(e) { this.setData({ maxPrice: e.detail.value }); },
  applyPrice() { this.triggerSearch(); },

  resetFilter() {
    this.setData({ category: '', condition: '', minPrice: '', maxPrice: '', sort: 'new' });
    if (this.data.searched) this.triggerSearch();
  },

  triggerSearch() {
    this.setData({ searched: true, page: 1, list: [], hasMore: true });
    const kw = (this.data.kw || '').trim();
    if (kw) this._saveHistory(kw);
    this._fetch();
  },

  _saveHistory(kw) {
    let h = wx.getStorageSync('cm_search_history') || [];
    h = [kw, ...h.filter(x => x !== kw)].slice(0, 10);
    wx.setStorageSync('cm_search_history', h);
    this.setData({ history: h });
  },

  clearHistory() {
    wx.removeStorageSync('cm_search_history');
    this.setData({ history: [] });
  },

  async _fetch() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = this.data.page;
    try {
      const data = await call('goods', {
        action: 'list', page, pageSize: this.data.pageSize,
        keyword: this.data.kw,
        category: this.data.category,
        condition: this.data.condition,
        minPrice: this.data.minPrice,
        maxPrice: this.data.maxPrice,
        sort: this.data.sort
      }, { silent: true, loading: false });
      const list = page === 1 ? data.list : this.data.list.concat(data.list);
      this.setData({ list, hasMore: data.hasMore, page: page + 1, total: list.length, loadError: '' });
    } catch (e) {
      // 不再静默吞异常：失败与「真的没搜到」在页面上必须可区分
      console.error('搜索加载失败', e);
      if (page === 1 && !this.data.list.length) {
        this.setData({ loadError: (e && e.msg) || '搜索失败，请重试' });
      }
    }
    this.setData({ loading: false });
  },

  /** 搜索失败后点「重试」 */
  retry() {
    this.setData({ loadError: '' });
    this._fetch();
  },

  loadMore() { this._fetch(); },

  onReachBottom() {
    if (this.data.searched && this.data.hasMore && !this.data.loading) this._fetch();
  },

  goDetail(e) {
    const { id } = e.detail || {};
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});
