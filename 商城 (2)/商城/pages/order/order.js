const { call } = require('../../utils/cloud.js');
const { formatTime, STATUS_ORDER, condText } = require('../../utils/util.js');
// 分类中文名统一走 utils/categories.js（此前本页自写了一份 find，与其它页重复）
const { catName } = require('../../utils/categories.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function toYMD(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

Page({
  data: {
    tabs: [
      { key: '', label: '全部' },
      { key: 'pending', label: '待确认' },
      { key: 'meeting', label: '待见面' },
      { key: 'completed', label: '已完成' },
      { key: 'cancelled', label: '已取消' }
    ],
    current: '',
    role: 'buyer',
    action: '',
    list: [], loadError: '', page: 1, pageSize: 20, hasMore: true, loading: false,
    // 防重复提交锁：下单是「一对一」的写操作，慢网络下连点会并发创建多个订单
    submitting: false,
    goods: null,
    form: { meetingTime: '', meetingPlace: '', message: '' },
    meetingTimeText: '',
    dateStart: '', dateEnd: '',
    // 封面加载失败兜底：{ [orderId 或 'goods']: true } → 渲染占位图
    // （订单快照里的 cover 是 10 分钟临时链接，过期后会 403，必须兜底）
    imgErr: {},
    defaultCover: '/images/goods-cover-default.png',
    STATUS_ORDER
  },

  /** 单个订单封面加载失败 → 标记该行，回退占位图 */
  onCoverErr(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.imgErr[id]) return;
    this.setData({ ['imgErr.' + id]: true });
  },

  onLoad(opt = {}) {
    const role = opt.role || 'buyer';
    const status = opt.status || '';
    const action = opt.action || '';
    const goodsId = opt.goodsId || '';
    this.setData({ role, current: status, action });
    if (action === 'create' && goodsId) this.loadGoods(goodsId);
    else { this._first = true; this.fetch(true); } // onLoad 已拉过一次，首次 onShow 不再重复请求
  },

  onShow() {
    // 自提点选择返回时取回
    const pickup = wx.getStorageSync('cm_pickup_chosen');
    if (pickup) {
      this.setData({ 'form.meetingPlace': pickup });
      wx.removeStorageSync('cm_pickup_chosen');
    }
    // onLoad→onShow 会连续触发：首次 onShow 跳过，否则进页面就发两次请求（首页曾踩过同款坑）
    if (this._first) { this._first = false; return; }
    if (this.data.action !== 'create') this.fetch(true);
  },

  onPullDownRefresh() {
    if (this.data.action !== 'create') this.fetch(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() { if (this.data.hasMore && !this.data.loading && this.data.action !== 'create') this.fetch(); },

  /** 「点击加载更多」手动分页（onReachBottom 之外补充入口） */
  loadMore() {
    if (this.data.hasMore && !this.data.loading && this.data.action !== 'create') this.fetch();
  },

  setTab(e) {
    this.setData({ current: e.currentTarget.dataset.key }, () => this.fetch(true));
  },

  async fetch(reset = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      const r = await call('order', {
        action: 'list', role: this.data.role, status: this.data.current,
        page, pageSize: this.data.pageSize
      }, { silent: true, loading: false });
      const raw = reset ? (r.list || []) : this.data.list.concat(r.list || []);
      // WXML 不能调用函数，时间在 JS 层格式化后再渲染
      const list = raw.map(o => ({ ...o, createdAtText: formatTime(o.createdAt) }));
      this.setData({ list, hasMore: r.hasMore, page: page + 1, loadError: '' });
    } catch (e) {
      // 不再静默吞异常：失败若显示成「还没有订单」会让用户以为订单丢了
      console.error('订单列表加载失败', e);
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

  async loadGoods(id) {
    try {
      const g = await call('goods', { action: 'detail', id }, { silent: true, loading: false });
      // 限制自提时间为一周内（基于今天）
      const today = new Date();
      const week = new Date(today.getTime() + 7 * 86400000);
      this.setData({
        goods: g,
        dateStart: toYMD(today),
        dateEnd: toYMD(week),
        goodsCondText: condText(g.condition),
        goodsCatName: catName(g.category)
      });
    } catch (e) {}
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value });
  },

  /** 自提时间 picker（mode=date）：限定一周内 */
  onTimeChange(e) {
    const v = e.detail.value; // 'YYYY-MM-DD'
    if (!v) return;
    this.setData({
      'form.meetingTime': v,
      meetingTimeText: v
    });
  },

  choosePickup() {
    wx.navigateTo({ url: '/pages/pickup/pickup' });
  },

  async submit() {
    const goodsId = this.data.goods && this.data.goods._id;
    if (!goodsId) return;
    // 防重复下单：连点会并发发多次 create，配合服务端的原子抢占双保险
    if (this.data.submitting) return;
    if (!this.data.form.meetingTime) return wx.showToast({ title: '请选择自提时间', icon: 'none' });
    if (!this.data.form.meetingPlace) return wx.showToast({ title: '请选择自提点', icon: 'none' });
    this.setData({ submitting: true });
    try {
      const r = await call('order', {
        action: 'create', goodsId,
        meetingTime: this.data.form.meetingTime,
        meetingPlace: this.data.form.meetingPlace,
        message: this.data.form.message
      });
      wx.showToast({ title: '已提交预约，等待对方确认', icon: 'success' });
      // 成功后跳转，锁保持到页面离开（避免跳转动画期间又被点一次）
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${r._id}` });
      }, 800);
    } catch (e) {
      // 服务器错误已在 utils/cloud 里 toast
      this.setData({ submitting: false });
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}` });
  },

  /** 写操作锁：连点会并发发多次请求（服务端已加条件更新兜底，这里再挡一层，避免无谓请求与重复提示） */
  _lock() { if (this._busy) return false; this._busy = true; return true; },
  _unlock() { this._busy = false; },

  async accept(e) {
    const id = e.currentTarget.dataset.id;
    if (!this._lock()) return;
    try {
      await call('order', { action: 'sellerConfirm', orderId: id, accept: true });
      wx.showToast({ title: '已接受' });
      this.fetch(true);
    } catch (e) {} finally { this._unlock(); }
  },

  async reject(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '拒绝订单', editable: true, placeholderText: '可填写理由',
      success: async (r) => {
        if (!r.confirm) return;
        if (!this._lock()) return;
        try {
          await call('order', { action: 'sellerConfirm', orderId: id, accept: false, reason: r.content || '卖家拒绝' });
          wx.showToast({ title: '已拒绝' });
          this.fetch(true);
        } catch (e) {} finally { this._unlock(); }
      }
    });
  },

  async complete(e) {
    const id = e.currentTarget.dataset.id;
    if (!this._lock()) return;
    try {
      await call('order', { action: 'complete', orderId: id });
      wx.showToast({ title: '订单已完成' });
      this.fetch(true);
    } catch (e) {} finally { this._unlock(); }
  },

  // 取消订单：买家在 pending/meeting 可取消，卖家在 meeting 可取消
  cancelOrder(e) {
    const id = e.currentTarget.dataset.id;
    const action = this.data.role === 'buyer' ? 'buyerCancel' : 'sellerCancel';
    wx.showModal({
      title: '取消订单',
      content: '取消后商品会重新上架，确定取消吗？',
      success: async (r) => {
        if (!r.confirm) return;
        if (!this._lock()) return;
        try {
          await call('order', { action, orderId: id });
          wx.showToast({ title: '已取消' });
          this.fetch(true);
        } catch (err) {} finally { this._unlock(); }
      }
    });
  },

  goReview(e) {
    wx.navigateTo({ url: `/pages/review/review?orderId=${e.currentTarget.dataset.id}` });
  }
});