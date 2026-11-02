const { call } = require('../../utils/cloud.js');
const app = getApp();
const { CATEGORIES, catName } = require('../../utils/categories.js');

// 切换分类的最小间隔：防止「10 个分类连点」打满并发。
// 实测单身份网关限流点在 30 并发（见 docs/容量上限评测报告.md），
// 连点会瞬间产生 10 个在途请求，叠加首屏本身的分页请求极易触发 -404006。
const SWITCH_THROTTLE_MS = 200;

// 列表快照缓存 TTL：切回 tab / 重排 / 下拉刷新时先秒出同组合旧数据，再后台静默刷新。
// 仅缓存第一页；60s 足够覆盖连续返回场景，又不会长期看到过期列表。
const SNAP_TTL = 60 * 1000;

/**
 * 卡通贴纸感的倾斜角度表。
 * 由 JS 按索引算好写进内联 style（`--tilt`），而不是在 wxss 里写 :nth-child ——
 * 后者只能覆盖写死的前 N 项，新增分类就没有倾斜，且外层多包一层容器时容易被误伤。
 * 循环取用，任意数量的分类都有自然的「随手贴上去」效果。
 */
const TILTS = ['-3deg', '2.5deg', '-2deg', '3deg', '-2.5deg', '2deg'];
const tiltOf = i => TILTS[i % TILTS.length];

/**
 * 分类 key → 左侧栏 DOM id。
 * 「全部」的 key 是空串，不能直接拼 `cat-`（scroll-into-view 不认空后缀），
 * 统一兜底为 `cat-all`，与 wxml 里的 `id="cat-{{item.key || 'all'}}"` 对齐。
 */
const scrollIdOf = key => 'cat-' + (key || 'all');

Page({
  data: {
    // 每个分类带上倾斜角度，wxml 直接 inline style 使用
    cats: CATEGORIES.map((c, i) => Object.assign({}, c, { tilt: tiltOf(i) })),
    current: '',
    name: '全部',
    sort: 'new',
    list: [],
    loadError: '',
    // 左侧栏滚动目标：10 个分类总高远超一屏，切换后必须把选中项滚进视口，
    // 否则点了靠后的分类看不出自己选了哪个。
    scrollIntoView: '',
    page: 1, pageSize: 20, hasMore: true, loading: false,
    // 首屏骨架屏占位卡片数量
    skeletonN: 4
  },

  onLoad(opt = {}) {
    // URL 直跳（非 tabBar 方式进入，如分享链接）
    if (opt.key !== undefined) {
      const key = opt.key || '';
      const name = opt.name || catName(key) || '全部';
      wx.setNavigationBarTitle({ title: name });
      this.setData({ current: key, name, scrollIntoView: scrollIdOf(key) });
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
        this.setData({
          current: cached.key, name: cached.name || '全部',
          scrollIntoView: scrollIdOf(cached.key)
        });
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
    // 节流：间隔内的连点直接丢弃（列表内容由下方 fetchList 的请求令牌保证最终一致）
    const now = Date.now();
    if (this._switchingAt && now - this._switchingAt < SWITCH_THROTTLE_MS) return;
    this._switchingAt = now;
    const name = catName(key) || '全部';
    wx.setNavigationBarTitle({ title: name });
    this.setData({ current: key, name, scrollIntoView: scrollIdOf(key) }, () => this.fetchList(true));
  },

  setSort(e) {
    const sort = e.currentTarget.dataset.sort;
    if (sort === this.data.sort) return;
    this.setData({ sort }, () => this.fetchList(true));
  },

  // 列表快照缓存：切回 tab / 重排 / 下拉刷新时，先秒出上次同组合（分类+排序）的数据，
  // 立刻出图不白屏，再后台静默刷新拿到最新。仅缓存第一页，避免与分页状态打架。
  _comboKey() { return (this.data.current || '') + '|' + (this.data.sort || ''); },

  async fetchList(reset = false) {
    if (this.data.loading) return;
    // 请求令牌：切分类会产生「旧请求在途、新请求已发」的竞态，
    // 旧请求后返回会把上一个分类的商品覆盖回来（表现为「点了没反应/列表串了」）。
    // 只有令牌最新的请求才允许写 data，其余静默丢弃。
    const token = (this._reqToken || 0) + 1;
    this._reqToken = token;
    this._snap = this._snap || {};
    const comboKey = this._comboKey();
    if (reset) {
      const snap = this._snap[comboKey];
      // 有 60s 内的同组合快照 → 直接出图，不打 loading（避免骨架/转圈，体感秒开）
      if (snap && snap.list.length && Date.now() - snap.ts < SNAP_TTL) {
        this.setData({ list: snap.list, hasMore: snap.hasMore, page: snap.page, loadError: '' });
      } else {
        this.setData({ loading: true }); // 仅首屏且无缓存才显示骨架
      }
    } else {
      this.setData({ loading: true });
    }
    const page = reset ? 1 : this.data.page;
    try {
      const data = await call('goods', {
        action: 'list', page, pageSize: this.data.pageSize,
        category: this.data.current, sort: this.data.sort
      }, { silent: true });
      if (token !== this._reqToken) return; // 已被更新的请求取代，丢弃本次结果
      const list = reset ? data.list : this.data.list.concat(data.list);
      this.setData({ list, hasMore: data.hasMore, page: page + 1, loadError: '' });
      // 仅第一页进快照（reset）；后台刷新回来也会更新快照，保证下次秒出的是最新
      if (reset) this._snap[comboKey] = { list, hasMore: data.hasMore, page: page + 1, ts: Date.now() };
    } catch (e) {
      if (token !== this._reqToken) return; // 过期请求的失败不应污染当前状态
      console.error('分类商品加载失败', e);
      // 已有快照兜底（用户已看到内容）就不弹错误，否则首屏无数据时显式提示 + 可重试
      if (!this.data.list.length) this.setData({ loadError: (e && e.msg) || '加载失败，请重试' });
    }
    if (token === this._reqToken) this.setData({ loading: false });
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
