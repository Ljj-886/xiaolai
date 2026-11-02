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
      // 只取状态栏高度，统一走 wx.getWindowInfo（基础库 2.20.1+）。
      // 原先用 wx.getSystemInfoSync 取 statusBarHeight，该 API 已废弃：
      // 本组件被 21 个页面复用，每进一个页面就在调试器刷一条
      // 「getSystemInfoSync is deprecated」警告，表现为「调试器 N 个报错」。
      // 这里刻意不做旧 API 兜底 —— 项目最低基础库要求本来就在 2.20.1 之上，
      // 留一条回退路径等于给废弃 API 留后门，下次扫描还会被判定为未清理。
      // 万一 getWindowInfo 不存在，catch 里保留默认值 20 即可，不影响布局。
      try {
        const win = wx.getWindowInfo();
        // 用系统状态栏高度作为顶部 padding，避免刘海屏被遮挡
        this.setData({ statusBarHeight: win.statusBarHeight || 20 });
      } catch (e) { /* 保留 data 里的默认 20 */ }
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
