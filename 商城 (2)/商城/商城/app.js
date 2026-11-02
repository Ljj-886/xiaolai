// app.js
App({
  globalData: {
    openid: '',
    userInfo: null,
    appVersion: '1.0.0',
    // 未读消息总数：自定义 tabBar 下原生角标 API 失效，这里做一份缓存供组件首次渲染使用
    unread: 0
    // 学校清单与各校自提点由 school 云函数统一下发（utils/school.js 缓存），
    // 不再在客户端写死；商品/交易按 users.school 隔离
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信版本过低，请升级到最新微信后重试');
      wx.showModal({
        title: '提示',
        content: '请将微信升级到最新版本后再使用本小程序',
        showCancel: false
      });
      return;
    }
    wx.cloud.init({
      env: 'cloud1-d6gxmdbcqf5d51f3e',
      traceUser: true
    });
    this.initUser();
  },

  onShow() {
    // 回到前台时刷新「消息」tab 的未读角标
    this.refreshUnreadBadge();
  },

  /** 全局 JS 错误：显式打日志，避免静默丢失（真机可在 vConsole 看到） */
  onError(err) {
    console.error('[App onError]', err);
  },

  /** 未捕获的 Promise 异常：同上，显式记录便于排查 */
  onUnhandledRejection(res) {
    console.error('[App onUnhandledRejection]', (res && (res.reason || res)) || res);
  },

  /** 页面路径不存在：兜底回首页，不要让用户停在白屏 */
  onPageNotFound(res) {
    console.error('[App onPageNotFound]', res && res.path);
    wx.switchTab({ url: '/pages/index/index' });
  },

  /**
   * 刷新「消息」tab 的未读角标。
   * 此前未读数只在「消息」页内部显示，用户在其他页面完全感知不到新消息。
   */
  refreshUnreadBadge() {
    if (!this.globalData.openid) return;
    wx.cloud.callFunction({ name: 'chat', data: { action: 'convs' } })
      .then(res => {
        const list = (res && res.result && res.result.data && res.result.data.list) || [];
        const total = list.reduce((n, c) => n + (Number(c.unreadCount) || 0), 0);
        this.setUnreadBadge(total);
      })
      .catch(() => {});
  },

  /**
   * 同步自定义 tabBar 的选中项与未读角标。
   * 因为启用了自定义 tabBar（app.json 里 tabBar.custom = true），框架**不会**自动维护选中态，
   * 每个 tab 页都需要在 onShow 里调一次本方法告知「当前是第几个 tab」。
   */
  syncTabBar(index) {
    const bar = this._tabBar();
    if (!bar) return;
    const patch = { unread: this.globalData.unread || 0 };
    if (typeof index === 'number') patch.selected = index;
    bar.setData(patch);
  },

  /** 取当前页面的自定义 tabBar 组件实例（非 tab 页返回 null） */
  _tabBar() {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      if (!cur || typeof cur.getTabBar !== 'function') return null;
      return cur.getTabBar() || null;
    } catch (e) { return null; }
  },

  /**
   * 设置/清除未读角标（tabBar 顺序：首页 分类 发布 消息 我的 → 消息 index=3）。
   * 注意：自定义 tabBar 下 `wx.setTabBarBadge` **不生效**，
   * 所以这里改为把未读数推给组件自行渲染（角标样式也随贴纸风统一）。
   */
  setUnreadBadge(n) {
    const count = Number(n) || 0;
    this.globalData.unread = count;
    const bar = this._tabBar();
    if (bar) bar.setData({ unread: count });
  },

  /** 拉取 openid + 最新用户资料，并落库
 *  同步会触发 me() 的「campus 一致性兜底」：用户换校后旧商品会静默同步到新校
 *  返回 Promise 便于页面 await
 */
  initUser() {
    if (this._initPromise) return this._initPromise;
    const cached = wx.getStorageSync('cm_openid');
    if (cached) this.globalData.openid = cached;
    this._initPromise = new Promise(resolve => {
      wx.cloud.callFunction({ name: 'login', data: {} })
        .then(res => {
          // login 云函数返回 { code, data: { openid, userInfo } }
          const payload = (res && res.result && res.result.data) ? res.result.data : (res && res.result) || {};
          const openid = payload.openid || (payload.userInfo && payload.userInfo._openid) || '';
          if (openid) {
            this.globalData.openid = openid;
            this.globalData.userInfo = payload.userInfo || this.globalData.userInfo;
            wx.setStorageSync('cm_openid', openid);
          }
          resolve(this.globalData.openid);
        })
        .catch(err => {
          console.warn('login 调用失败（开发期可忽略）', err);
          resolve(this.globalData.openid || '');
        });
    });
    // 启动后异步调 me() 触发换校同步（不阻塞 openid 返回；失败也不影响 UI）
    this._initPromise.then(openid => {
      if (!openid) return;
      this.refreshUnreadBadge(); // openid 就绪后再刷未读角标（onShow 时可能还没拿到）
      wx.cloud.callFunction({ name: 'user', data: { action: 'me' } })
        .then(r => {
          const d = r && r.result && r.result.data;
          if (d) this.globalData.userInfo = { ...(this.globalData.userInfo || {}), ...d };
        })
        .catch(e => console.warn('initUser me() 同步失败（无碍）', e));
    });
    return this._initPromise;
  },

  /** 提示并跳到登录/认证 */
  requireLogin(cb) {
    if (!this.globalData.openid) {
      this.initUser().then(() => {
        if (this.globalData.userInfo) { cb && cb(); return; }
        this._showLoginModal();
      });
      return;
    }
    if (this.globalData.userInfo) { cb && cb(); return; }
    this._showLoginModal();
  },

  _showLoginModal() {
    wx.showModal({
      title: '需要登录',
      content: '请先完成学生认证后继续',
      confirmText: '去认证',
      success: r => {
        if (r.confirm) wx.navigateTo({ url: '/pages/verify/verify' });
      }
    });
  },

  /** 判断当前用户是否已认证 */
  isVerified() {
    return this.globalData.userInfo && this.globalData.userInfo.verified;
  }
});