const app = getApp();

/**
 * 自定义 tabBar（手绘贴纸风）
 *
 * 为什么自定义：原生 tabBar 只支持改文字/图标颜色，做不出「药丸选中态」和描边风格。
 * 代价（必须自己处理）：
 *  1. `wx.setTabBarBadge` 在 custom 模式下失效 → 未读角标改为本组件内自行渲染，
 *     由 app.syncTabBar() / app.setUnreadBadge() 把未读数推进来；
 *  2. 选中项要由各 tab 页在 onShow 里通过 app.syncTabBar(index) 主动告知。
 *
 * 注意：不要在 attached() 里用 getCurrentPages() 反推选中项 ——
 * 实测组件挂载时当前路由可能仍是上一个页面，会把高亮指错（消息页踩过）。
 * 可靠的时机是 pageLifetimes.show（页面显示时回调）。
 */
Component({
  data: {
    selected: 0,
    unread: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: '/images/tab_home.png', iconOn: '/images/tab_home_on.png' },
      { pagePath: '/pages/category/category', text: '分类', icon: '/images/tab_category.png', iconOn: '/images/tab_category_on.png' },
      { pagePath: '/pages/publish/publish', text: '发布', icon: '/images/tab_publish.png', iconOn: '/images/tab_publish_on.png' },
      { pagePath: '/pages/chat/chat', text: '消息', icon: '/images/tab_chat.png', iconOn: '/images/tab_chat_on.png', badge: true },
      { pagePath: '/pages/mine/mine', text: '我的', icon: '/images/tab_mine.png', iconOn: '/images/tab_mine_on.png' }
    ]
  },

  pageLifetimes: {
    // 页面显示时兜底校正选中态：即使页面 onShow 早于组件挂载，这里也能纠正过来
    show() { this._syncFromRoute(); }
  },

  attached() {
    // 只同步未读数；选中态交给 pageLifetimes.show / app.syncTabBar
    if (app && app.globalData) this.setData({ unread: app.globalData.unread || 0 });
  },

  methods: {
    _syncFromRoute() {
      try {
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        if (!cur || !cur.route) return;
        const idx = this.data.list.findIndex(t => t.pagePath === '/' + cur.route);
        if (idx >= 0 && idx !== this.data.selected) this.setData({ selected: idx });
      } catch (e) { /* 忽略：保持现有选中态 */ }
    },

    onTap(e) {
      const ds = e.currentTarget.dataset;
      const index = Number(ds.index);
      if (index === this.data.selected) return; // 已在当前 tab，避免无谓的 switchTab
      wx.switchTab({ url: ds.path });
    }
  }
});
