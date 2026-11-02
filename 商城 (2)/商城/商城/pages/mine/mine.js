const app = getApp();
const { call } = require('../../utils/cloud.js');

Page({
  data: {
    user: {},
    logged: false,
    version: app.globalData.appVersion,
    defaultAvatar: '/images/avatar-default.png',
    avatarErr: false // 头像加载失败（存储链接过期/服务不可用）→ 回退默认头像
  },

  /** 头像加载失败兜底 */
  onAvatarErr() {
    if (this.data.avatarErr) return;
    this.setData({ avatarErr: true });
  },

  /**
   * 写入用户信息；**只有头像地址发生变化时**才清掉「加载失败」标记。
   * 不能无条件清标记：地址没变时清掉标记会把 src 换回那个已失败的地址，
   * 而渲染层通常不会再对同一地址重发 error 事件 → 头像会永久空白
   * （这正是「显示默认图」类问题的相反面，实测踩到过）。
   */
  applyUser(me) {
    const next = (me && me.avatarUrl) || '';
    const changed = next !== this._lastAvatar;
    this._lastAvatar = next;
    const patch = { user: me, logged: true };
    if (changed && this.data.avatarErr) patch.avatarErr = false;
    this.setData(patch);
  },

  onShow() {
    app.syncTabBar(4); // 同步自定义 tabBar 的选中态
    this.fetch();
  },

  async fetch() {
    // 登录态以本地标记为准：'1' 已登录 / '0' 已退出 / 无标记 老用户待迁移
    const flag = wx.getStorageSync('cm_logged');
    if (flag === '0') {
      this.setData({ logged: false, user: {} });
      return;
    }
    if (flag !== '1') {
      // 兼容老用户：已授权过头像+昵称的自动补标记，不打断使用
      await app.initUser();
      if (app.globalData.openid) {
        try {
          const me = await call('user', { action: 'me' }, { silent: true, loading: false });
          if (me && me.avatarUrl && me.nickName) {
            wx.setStorageSync('cm_logged', '1');
            this.applyUser(me);
            app.globalData.userInfo = me;
            return;
          }
        } catch (e) {}
      }
      this.setData({ logged: false, user: {} });
      return;
    }
    await app.initUser();
    if (!app.globalData.openid) {
      this.setData({ logged: false, user: {} });
      return;
    }
    try {
      const me = await call('user', { action: 'me' }, { silent: true, loading: false });
      this.applyUser(me);
      app.globalData.userInfo = me;
    } catch (e) {
      this.setData({ logged: false, user: {} });
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  editProfile() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/edit-profile/edit-profile' });
  },
  goVerify() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/verify/verify' });
  },
  goOrder(e) {
    if (!this.data.logged) return this.goLogin();
    const { role, status } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/order/order?role=${role || 'buyer'}&status=${status || ''}` });
  },
  goMyGoods(e) {
    if (!this.data.logged) return this.goLogin();
    const { status } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/sold/sold?status=${status || ''}` });
  },
  goFavorite() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/favorite/favorite' });
  },
  goMyWants() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/sold/sold?type=want' });
  },
  goAdmin() { wx.navigateTo({ url: '/pages/admin/admin' }); },
  goCredit() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/credit/credit' });
  },
  goAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }); },
  goFeedback() { wx.navigateTo({ url: '/pages/feedback/feedback' }); },

  /** 退出登录：清空本地登录态（云端数据保留，重新登录后恢复） */
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需重新使用微信账号登录，你的商品、订单和认证信息不会丢失。',
      confirmText: '退出',
      confirmColor: '#FF3B30',
      success: r => {
        if (!r.confirm) return;
        wx.setStorageSync('cm_logged', '0'); // 显式退出态（区别于未迁移的老用户）
        wx.removeStorageSync('cm_openid');
        app.globalData.openid = '';
        app.globalData.userInfo = null;
        app._initPromise = null; // 重置，下次 initUser 重新拉取
        this.setData({ logged: false, user: {} });
        wx.showToast({ title: '已退出登录', icon: 'success' });
      }
    });
  },

  /** 清除本地缓存：只清展示类缓存，登录态/收藏表情不动 */
  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清除搜索历史、分类筛选、自提点选择等本地缓存，不影响登录状态和云端数据。',
      confirmText: '清除',
      success: r => {
        if (!r.confirm) return;
        // 只清安全的展示类缓存；cm_logged/cm_openid（登录态）、cm_my_emojis（收藏表情）保留
        ['cm_search_history', 'cm_cat_filter', 'cm_pickup_chosen', 'cm_pickup_history', 'cm_edit_goods_id', 'cm_last_timeout_check']
          .forEach(k => wx.removeStorageSync(k));
        wx.showToast({ title: '已清除', icon: 'success' });
        this.fetch(); // 刷新页面数据
      }
    });
  },

  showAbout() {
    wx.showModal({
      title: '校园集市',
      content: `校园闲置物品信息共享平台\n同校自提，安全便捷\n当前版本 v${app.globalData.appVersion}`,
      showCancel: false
    });
  }
});
