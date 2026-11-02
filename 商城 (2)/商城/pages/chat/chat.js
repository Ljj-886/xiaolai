const { call } = require('../../utils/cloud.js');
const { fromNow } = require('../../utils/util.js');
const app = getApp();

Page({
  data: {
    list: [],
    loadError: '',
    page: 1, pageSize: 20, hasMore: true, loading: false,
    defaultAvatar: '/images/avatar-default.png',
    // 对端头像加载失败兜底：{ [convId]: true } → 该行渲染默认头像
    // （头像临时链接会过期，不兜底会出现一片裂图）
    peerAvatarErr: {}
  },

  /** 会话头像加载失败 → 标记该行，回退默认头像（必须同时改 src，否则永久空白） */
  onAvatarErr(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.peerAvatarErr[id]) return;
    this.setData({ ['peerAvatarErr.' + id]: true });
  },

  onShow() { app.syncTabBar(3); this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.fetch(); },

  async fetch(reset = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      const r = await call('chat', { action: 'convs', page, pageSize: this.data.pageSize }, { silent: true, loading: false });
      // WXML 不能调用 JS 函数（setData 会丢弃函数），时间在 JS 层格式化好再渲染
      const incoming = (r.list || []).map(c => ({
        ...c,
        lastMessageAtText: c.lastMessageAt ? fromNow(c.lastMessageAt) : ''
      }));
      const list = reset ? incoming : this.data.list.concat(incoming);
      this.setData({ list, hasMore: r.hasMore, page: page + 1, loadError: '' });
      // 同步 tabBar 未读角标：直接用刚拿到的数据算，不额外发请求
      try {
        getApp().setUnreadBadge(list.reduce((n, c) => n + (Number(c.unreadCount) || 0), 0));
      } catch (e) {}
    } catch (e) {
      // 不再静默吞异常：失败时直接显示「暂无消息」会掩盖真实故障
      console.error('会话列表加载失败', e);
      if (!this.data.list.length) {
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

  /** 点击「加载更多」/ 触底 → 追加下一页会话 */
  loadMore() { this.fetch(); },

  async open(e) {
    const conv = e.currentTarget.dataset.conv;
    if (!conv) return;
    await app.initUser(); // openid 未就绪时无法正确识别对方
    const peer = conv.participants.find(p => p !== app.globalData.openid);
    wx.navigateTo({ url: `/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId}` });
  },

  // 长按会话项 → 二次确认后删除（含级联消息）
  async onLongPress(e) {
    const conv = e.currentTarget.dataset.conv;
    if (!conv) return;
    const confirm = await new Promise(resolve => {
      wx.showModal({
        title: '删除会话',
        content: `确定删除与「${conv.peerInfo && conv.peerInfo.nickName || '同学'}」的对话吗？聊天记录将一并删除。`,
        confirmText: '删除',
        confirmColor: '#e64340',
        success: r => resolve(!!r.confirm)
      });
    });
    if (!confirm) return;
    // 防重复删除：连点长按会弹两个确认框并连发两次删除
    if (this._deleting) return;
    this._deleting = true;
    // ⚠️ 不要写 `if (r.code !== 0)`：utils/cloud.js 的 call() 成功时 resolve 的是
    //    res.result.data（**不含 code 字段**），失败时直接 reject —— 检查 r.code 恒为真，
    //    会导致「删除成功却弹删除失败」。统一用 try/catch。
    try {
      await call('chat', { action: 'deleteConversation', convId: conv._id }, { loading: '删除中…', silent: true });
      this.setData({ list: this.data.list.filter(c => c._id !== conv._id) });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.msg) || '删除失败，请重试', icon: 'none' });
    } finally { this._deleting = false; }
  },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); }
});
