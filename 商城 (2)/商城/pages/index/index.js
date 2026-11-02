const app = getApp();
const { call } = require('../../utils/cloud.js');
const { CATEGORIES } = require('../../utils/categories.js');

// —— 首屏性能：SWR（stale-while-revalidate）缓存 ——
// 进入首页先渲染上次的列表（秒开），再在后台拉最新；若数据未变则跳过 setData，
// 避免重复渲染与 <image> 重新加载（这是"回到首页闪一下 / 图片重刷"的根因）。
//
// 【重要】缓存里存的是「整份列表」，其中 item.cover 是云存储的**临时链接**，
// 实测有效期只有约 30 分钟（过期后请求直接 403，图片全裂）。
// 因此「能否直接渲染缓存」和「能否跳过 setData」都必须以「图链是否还新鲜」为前提：
// 否则页面会抱着已 403 的旧图链不放，而且因为去重命中会不断刷新缓存时间戳，
// 缓存永远不过期 → 图片永久裂图（这就是线上「图片不见了」的根因）。
const CACHE_KEY = 'cm_home_list_v1';
// 微信云存储「私有读」文件的临时链接**默认只有 10 分钟有效期**（官方文档：公有读不过期、
// 私有读十分钟）。实测 5 分钟正常、28 分钟已 403；maxAge 参数经实测不可靠
//（maxAge=86400 返回的地址与默认完全相同）。故按 10 分钟设计，取 8 分钟作为安全阈值，
// 并让首页在可见期间定期换链。
const URL_SAFE_MS = 6 * 60 * 1000;    // 图链签发超过该年龄即视为不可靠，必须重新获取（TTL 10min，留 4min 余量）
const CACHE_MAX_AGE = URL_SAFE_MS;    // 缓存可直接渲染的最大年龄（不得大于图链有效期）
const CACHE_FRESH_MS = 60 * 1000;     // 60s 内的缓存视为新鲜，onShow 直接跳过网络请求
const URL_REFRESH_MS = URL_SAFE_MS;   // 首页可见期间定期换链的间隔（防长时间停留后裂图）

/** 取列表里图片临时链接的签发时间（URL 中的 t 参数，单位秒 → 毫秒）。取不到返回 0 */
function listUrlAt(list) {
  for (const it of (list || [])) {
    const m = /[?&]t=(\d+)/.exec((it && it.cover) || '');
    if (m) return Number(m[1]) * 1000;
  }
  return 0;
}

Page({
  data: {
    banners: [
      { id: 1, title: '毕业季清仓', sub: '带走美好，留下回忆', bg: '#FFD98A', key: '', name: '全部商品' },
      { id: 2, title: '同校自提', sub: '校园内自提更安全', bg: '#A9D9F5', page: '/pages/pickup/pickup' },
      { id: 3, title: '教材循环', sub: '让知识流动起来', bg: '#B7E4C7', key: 'book', name: '教材书籍' }
    ],
    cats: CATEGORIES,
    list: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    needSchool: false, // 未选学校：商品流被服务端隔离，需引导选择
    school: '', // 当前学校（搜索栏展示）
    type: 'sell', // 信息流类型：sell=出售中 / want=求购
    loadError: '', // 列表加载失败的具体原因（展示在页面上，避免"空白但不知为何"）
    myOpenid: '' // 当前用户 openid：首页卡片据此隐藏「举报」本人商品
  },

  onLoad() {
    this._first = true; // 首次 onShow 不再重复拉取（onLoad 已拉过一次）
    // ① 先用缓存秒开（有缓存时不闪白），② 再拉最新（有缓存时后台静默刷新）
    const hydrated = this._hydrateCache();
    this.fetchList(true, { background: hydrated });
  },

  onShow() {
    app.syncTabBar(0); // 同步自定义 tabBar 的选中态
    // 超时订单巡检（节流：本机 10 分钟内只触发一次，服务端幂等）
    this.maybeCheckOrderTimeout();
    // 搜索栏展示当前学校
    const me = app.globalData.userInfo;
    const openid = app.globalData.openid || wx.getStorageSync('cm_openid') || '';
    this.setData({ school: (me && me.school) || '', myOpenid: openid });
    // 可见期间定期换链：临时图链 10 分钟失效，用户长时间停留在首页若不换链就会看到裂图
    this._startUrlTimer();
    // 回到首页时刷新一次
    if (this._first) { this._first = false; return; }
    // 本机刚发生过商品写操作（发布/改价/上下架，见 publish/sold/detail 写入的脏标记）：
    // 跳过 60s 新鲜节流强制重拉，让「我刚发布 / 上架的商品」回到首页立刻可见，
    // 而不是最多等 60s 才刷新。标记比缓存新才生效，消费后即清除。
    const dirty = wx.getStorageSync('cm_home_dirty') || 0;
    if (dirty && dirty > (this._cacheAt || 0)) {
      wx.removeStorageSync('cm_home_dirty');
      this.fetchList(true, { background: true });
      return;
    }
    // 新鲜缓存（60s 内）→ 跳过网络请求；否则静默后台刷新（保留旧列表，不闪白）
    if (this._hasCache && Date.now() - this._cacheAt < CACHE_FRESH_MS) return;
    this.fetchList(true, { background: true });
  },

  onHide() { this._stopUrlTimer(); },
  onUnload() { this._stopUrlTimer(); },

  /** 首页可见期间定时后台刷新：只为换取新的图片临时链接（图链 10 分钟即失效） */
  _startUrlTimer() {
    if (this._urlTimer) return;
    this._urlTimer = setInterval(() => this.fetchList(true, { background: true }), URL_REFRESH_MS);
  },
  _stopUrlTimer() {
    if (this._urlTimer) { clearInterval(this._urlTimer); this._urlTimer = null; }
  },

  /** 用本地缓存秒开首页列表。返回是否命中可用缓存 */
  _hydrateCache() {
    try {
      const c = wx.getStorageSync(CACHE_KEY);
      if (!c || !Array.isArray(c.list) || !c.list.length) return false;
      if (Date.now() - (c.at || 0) > CACHE_MAX_AGE) return false; // 缓存太旧不用
      // 关键：缓存里的 cover 是临时链接，过期后 403。图链不新鲜就绝不拿它秒开
      //（否则用户先看到一片裂图），直接走网络重新取，用新链接渲染。
      const urlAt = c.urlAt || listUrlAt(c.list);
      if (!urlAt || Date.now() - urlAt > URL_SAFE_MS) return false;
      if ((c.type || 'sell') !== this.data.type) return false;     // 类型不符不用
      this._hasCache = true;
      this._cacheAt = c.at || Date.now();
      this._urlAt = urlAt;
      this._sig = c.sig || c.list.map(x => [
        x._id, x.price, x.status, x.title, (x.images || []).length,
        x.wantCount || 0, x.favCount || 0, x.viewCount || 0
      ].join('|')).join(',');
      this.setData({ list: c.list, page: c.page || 1, hasMore: c.hasMore !== false, loadError: '' });
      return true;
    } catch (e) { return false; }
  },

  /** 落盘缓存当前列表（滚动位置/分页一并记住，便于秒开后继续加载） */
  _saveCache() {
    try {
      wx.setStorageSync(CACHE_KEY, {
        at: Date.now(),
        // 记录「当前渲染的图链签发时间」。它必须随 list 一起存：只存 at 会让
        // 「商品没变」的缓存看起来永远新鲜，而图链其实早就 403 了。
        urlAt: this._urlAt || listUrlAt(this.data.list),
        type: this.data.type,
        list: this.data.list.slice(0, 20),
        page: this.data.page,
        hasMore: this.data.hasMore,
        sig: this._sig || ''
      });
    } catch (e) {}
  },

  maybeCheckOrderTimeout() {
    const KEY = 'cm_last_timeout_check';
    const last = wx.getStorageSync(KEY) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return;
    wx.setStorageSync(KEY, Date.now());
    call('order', { action: 'checkTimeout' }, { silent: true, loading: false })
      .then(() => {})
      .catch(() => {});
  },

  onPullDownRefresh() {
    this.fetchList(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetchList();
  },

  async fetchList(reset = false, opts = {}) {
    if (this.data.loading) return;
    const background = opts.background === true; // 后台静默刷新：不显示 loading、不清空列表
    if (!background) this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      // 不再传 type 给云函数（避免后端 type 过滤把历史无 type 字段商品切光），
      // 由前端按 item.type 兜底分类：type==='want' 视为求购，其余（含 undefined）一律视为出售
      const data = await call('goods', { action: 'list', page, pageSize: this.data.pageSize }, { silent: true, loading: false });
      const filtered = (data.list || []).filter(item => {
        if (this.data.type === 'want') return item.type === 'want';
        return item.type !== 'want'; // sell 视图：无 type / type='sell' / type=null 都视作出售
      });
      const list = reset ? filtered : this.data.list.concat(filtered);
      // 数据签名：首屏列表「内容」没变 → 跳过 setData，避免后台刷新命中相同数据时
      // 重渲染、让 <image> 重新拉图（消除"闪一下"）。
      //
      // ⚠️ 签名不能只用 _id 序列 —— 那样「同 _id、内容变化」的合法更新会被吞掉：
      //   实测复现：卖家改价 / 他人点「想要」后，首页一直显示旧价格、旧热度
      //  （_id 序列没变 → 签名相同 → 跳过 setData）。所以签名必须带上会变的内容字段。
      const sig = list.map(x => [
        x._id, x.price, x.status, x.title, (x.images || []).length,
        x.wantCount || 0, x.favCount || 0, x.viewCount || 0
      ].join('|')).join(',');
      // 「跳过渲染」还有个必需前提：页面上正在用的图链仍然新鲜。
      // 临时图链 10 分钟即失效 —— 若它已过期，即使商品没变也必须 setData 换成新链接，
      // 否则用户会一直看到 403 的裂图（线上「图片不见了」的根因）。
      const newUrlAt = listUrlAt(list);
      const renderingUrlsFresh = !!this._urlAt && (Date.now() - this._urlAt < URL_SAFE_MS);
      if (reset && sig === this._sig && renderingUrlsFresh && !this.data.loadError) {
        this._cacheAt = Date.now();
        this._hasCache = true;
        // 这里没有 setData，页面仍在用旧图链 → _urlAt 保持不动，
        // 让缓存的「新鲜度」跟真实图链一起变老，避免缓存被无限续命。
        this._saveCache();
      } else {
        this._sig = sig;
        this._urlAt = newUrlAt;
        this.setData({
          list,
          hasMore: data.hasMore,
          page: page + 1,
          needSchool: !!data.needSchool,
          loadError: '' // 加载成功 → 清掉上一轮的错误态
        });
        if (reset) { this._cacheAt = Date.now(); this._hasCache = true; }
        this._saveCache();
      }
    } catch (e) {
      // 此前这里静默吞掉异常：后端 500 时用户只看到一片空白，
      // 表现为「商品不见了」而不是「出错了」，极难排查（本次线上事故的根因之一）。
      // 改为把错误显示在页面上，并给出重试入口。
      console.error('首页商品列表加载失败', e);
      // 仅在没有可展示内容时才清空显示错误，避免后台刷新失败把已有列表也清掉
      if (reset && !this.data.list.length) {
        this.setData({
          list: [],
          loadError: (e && e.msg) || '加载失败，请重试'
        });
      }
    }
    if (!background) this.setData({ loading: false });
  },

  /** 加载失败后点「重试」 */
  retry() {
    this.setData({ loadError: '' });
    this.fetchList(true);
  },

  /** 未选学校 → 去编辑资料选择（选完回首页自动刷新） */
  goChooseSchool() {
    wx.navigateTo({ url: '/pages/edit-profile/edit-profile' });
  },

  loadMore() { this.fetchList(); },

  goSearch() { wx.navigateTo({ url: '/pages/search/search' }); },
  goPublish() { wx.switchTab({ url: '/pages/publish/publish' }); },

  setListType(e) {
    const t = e.currentTarget.dataset.type;
    if (t === this.data.type) return;
    // 切换闲置/求购：签名与缓存失效，清空列表后重新拉取（避免旧类型商品残留）
    this._sig = '';
    this._hasCache = false;
    this.setData({ type: t, list: [], page: 1, hasMore: true, loadError: '' }, () => this.fetchList(true));
  },

  goCategory(e) {
    const { key, name } = e.currentTarget.dataset;
    // category 是 tabBar 页面，必须用 switchTab；query 不可靠，用 storage 传参
    wx.setStorageSync('cm_cat_filter', { key: key || '', name: name || '全部' });
    wx.switchTab({ url: '/pages/category/category' });
  },

  goDetail(e) {
    const { id } = e.detail || {};
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /** 首页商品卡「举报」：跳转到举报页，targetType=goods 指向被举报商品 */
  onReport(e) {
    const { id } = e.detail || {};
    if (id) wx.navigateTo({ url: `/pages/report/report?targetType=goods&targetId=${id}` });
  },

  onBanner(e) {
    const { index } = e.currentTarget.dataset;
    const b = this.data.banners[index];
    if (!b) return;
    if (b.page) {
      // 普通页面（自提点列表等）
      wx.navigateTo({ url: b.page });
    } else if (b.key !== undefined) {
      // 分类 tab 页：switchTab + storage 传参（category.onShow 会消费）
      wx.setStorageSync('cm_cat_filter', { key: b.key, name: b.name });
      wx.switchTab({ url: '/pages/category/category' });
    }
  },

  /** 微信原生分享（好友/群）：右上角菜单转发首页 */
  onShareAppMessage() {
    const first = this.data.list.find(g => g.cover) || null;
    return {
      title: '校园集市 · 同校闲置物品共享平台',
      path: '/pages/index/index',
      imageUrl: (first && first.cover) || ''
    };
  },

  /** 分享到朋友圈（此前只有好友转发，缺朋友圈入口） */
  onShareTimeline() {
    const first = this.data.list.find(g => g.cover) || null;
    return {
      title: '校园集市 · 同校闲置物品共享平台',
      query: '',
      imageUrl: (first && first.cover) || ''
    };
  }
});
