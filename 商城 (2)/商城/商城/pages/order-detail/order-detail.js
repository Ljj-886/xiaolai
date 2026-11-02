const { call } = require('../../utils/cloud.js');
const { formatTime, STATUS_ORDER, condText } = require('../../utils/util.js');
const { CATEGORIES } = require('../../utils/constants.js');

Page({
  data: {
    id: '', order: null, isBuyer: false, isSeller: false, peerInfo: {},
    defaultAvatar: '/images/avatar-default.png',
    defaultCover: '/images/goods-cover-default.png',
    // 图片加载失败兜底（订单快照 cover 是 10 分钟临时链接，过期会 403）
    goodsCoverErr: false,
    peerAvatarErr: false,
    STATUS_ORDER
  },

  /** 商品封面加载失败 → 回退占位图（必须同时改 src，否则永久空白） */
  onGoodsCoverErr() {
    if (this.data.goodsCoverErr) return;
    this.setData({ goodsCoverErr: true });
  },

  /** 对端头像加载失败 → 回退默认头像 */
  onPeerAvatarErr() {
    if (this.data.peerAvatarErr) return;
    this.setData({ peerAvatarErr: true });
  },

  onLoad(opt) { this.setData({ id: opt.id }); },
  onShow() { this.fetch(); },

  async fetch() {
    try {
      const order = await call('order', { action: 'detail', orderId: this.data.id }, { silent: true, loading: false });
      const app = getApp();
      await app.initUser(); // openid 缺失会把买家误判成卖家
      const openid = app.globalData.openid;
      const isBuyer = order.buyerId === openid;
      const peerInfo = isBuyer ? order.sellerInfo : order.buyerInfo;
      // WXML 不能调用函数：时间/成色/分类在 JS 层算好再渲染
      const snap = order.goodsSnapshot || {};
      this.setData({
        order: {
          ...order,
          createdAtText: formatTime(order.createdAt) || '未知',
          completedAtText: formatTime(order.completedAt),
          sellerConfirmAtText: formatTime(order.sellerConfirmAt),
          cancelledAtText: formatTime(order.cancelledAt || (order.status === 'cancelled' ? order.updatedAt : ''))
        },
        condLabel: condText(snap.condition),
        catLabel: (CATEGORIES.find(c => c.key === snap.category) || {}).name || snap.category || '',
        isBuyer, isSeller: !isBuyer, peerInfo: peerInfo || {}
      });
    } catch (e) {}
  },

  goGoods() {
    if (this.data.order && this.data.order.goodsId) {
      wx.navigateTo({ url: `/pages/detail/detail?id=${this.data.order.goodsId}` });
    }
  },

  goChat() {
    const o = this.data.order;
    const peer = this.data.isBuyer ? o.sellerId : o.buyerId;
    wx.navigateTo({ url: `/pages/chatroom/chatroom?peer=${peer}&goodsId=${o.goodsId}` });
  },

  /** 点击对方头像/昵称区域 → 个人主页 */
  goPeer() {
    const o = this.data.order;
    if (!o) return;
    const peer = this.data.isBuyer ? o.sellerId : o.buyerId;
    if (!peer) return;
    wx.navigateTo({ url: `/pages/sold/sold?openid=${peer}` });
  },

  goReview() {
    wx.navigateTo({ url: `/pages/review/review?orderId=${this.data.id}` });
  },

  /** 写操作锁：连点会并发发多次请求（服务端已加条件更新兜底，这里再挡一层，避免重复提示） */
  _lock() { if (this._busy) return false; this._busy = true; return true; },
  _unlock() { this._busy = false; },

  async accept() {
    if (!this._lock()) return;
    try { await call('order', { action: 'sellerConfirm', orderId: this.data.id, accept: true }); this.fetch(); wx.showToast({ title: '已接受' }); } catch (e) {} finally { this._unlock(); }
  },
  reject() {
    wx.showModal({ title: '拒绝订单', editable: true, placeholderText: '可填写理由',
      success: async r => {
        if (!r.confirm) return;
        if (!this._lock()) return;
        try { await call('order', { action: 'sellerConfirm', orderId: this.data.id, accept: false, reason: r.content }); this.fetch(); wx.showToast({ title: '已拒绝' }); } catch (e) {} finally { this._unlock(); }
      }
    });
  },
  async cancel() {
    if (!this._lock()) return;
    try { await call('order', { action: 'buyerCancel', orderId: this.data.id, reason: '买家取消' }); this.fetch(); wx.showToast({ title: '已取消' }); } catch (e) {} finally { this._unlock(); }
  },
  /** 卖家在 meeting（已确认）状态下也可取消：防买家反悔/约定变更 */
  sellerCancel() {
    wx.showModal({
      title: '取消订单',
      content: '确认后订单将关闭，买家可能因此退款。商品会自动恢复在售',
      confirmText: '确认取消',
      confirmColor: '#FF4D4F',
      success: async r => {
        if (!r.confirm) return;
        if (!this._lock()) return;
        try {
          await call('order', { action: 'sellerCancel', orderId: this.data.id, reason: '卖家取消' });
          this.fetch();
          wx.showToast({ title: '已取消订单' });
        } catch (e) {} finally { this._unlock(); }
      }
    });
  },
  async complete() {
    if (!this._lock()) return;
    try { await call('order', { action: 'complete', orderId: this.data.id }); this.fetch(); wx.showToast({ title: '订单完成' }); } catch (e) {} finally { this._unlock(); }
  },

  /** 空状态下点击按钮 → 返回订单列表（order 不是 tabBar 页，不能用 switchTab） */
  goOrderList() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: '/pages/order/order' });
    }
  }
});
