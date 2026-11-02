Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    bg: { type: String, value: '#FFF9EE' }
  },
  data: {
    statusBarHeight: 20
  },
  lifetimes: {
    attached() {
      try {
        const sys = wx.getSystemInfoSync();
        // 用系统状态栏高度作为顶部 padding，避免刘海屏被遮挡
        this.setData({ statusBarHeight: sys.statusBarHeight || 20 });
      } catch (e) {}
    }
  },
  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        // 已是最底层（直接 wx.reLaunch 进来）→ 跳首页
        wx.switchTab({ url: '/pages/index/index' });
      }
      this.triggerEvent('back');
    }
  }
});
