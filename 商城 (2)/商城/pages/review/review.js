const { call } = require('../../utils/cloud.js');

Page({
  data: {
    orderId: '',
    score: 5, scoreText: '非常满意',
    tags: ['商品与描述一致', '对方很热情', '回复及时', '包装仔细', '价格公道', '值得推荐'],
    selected: {},
    content: '',
    peerName: '', peerRole: ''
  },

  onLoad(opt) {
    this.setData({ orderId: opt.orderId || '' });
    this.fetchPeer();
  },

  /** 拉取订单以确定对方是谁（用户已经知道评分对象，但页面要明示） */
  async fetchPeer() {
    if (!this.data.orderId) return;
    try {
      const o = await call('order', { action: 'detail', orderId: this.data.orderId }, { silent: true, loading: false });
      const app = getApp();
      const openid = app.globalData.openid;
      const isBuyer = o.buyerId === openid;
      const peer = isBuyer ? o.sellerInfo : o.buyerInfo;
      this.setData({
        peerName: (peer && peer.nickName) || (isBuyer ? '卖家' : '买家'),
        peerRole: isBuyer ? '卖家' : '买家'
      });
    } catch (e) {}
  },

  setScore(e) {
    const s = e.currentTarget.dataset.s;
    const map = ['', '非常差', '不满意', '一般', '满意', '非常满意'];
    this.setData({ score: s, scoreText: map[s] });
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag;
    const sel = { ...this.data.selected };
    sel[tag] = !sel[tag];
    this.setData({ selected: sel });
  },

  onInput(e) { this.setData({ content: e.detail.value }); },

  async submit() {
    const tags = Object.keys(this.data.selected).filter(k => this.data.selected[k]);
    if (this._submitting) return; // 防重复提交：一单只能评价一次，连点会产生重复评价
    this._submitting = true;
    try {
      await call('user', {
        action: 'review',
        orderId: this.data.orderId,
        score: this.data.score, tags, content: this.data.content
      });
      wx.showToast({ title: '已评价', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      // 错误已 toast
      this._submitting = false;
    }
  }
});