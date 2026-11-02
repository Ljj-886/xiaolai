const { call } = require('../../utils/cloud.js');
const { getMyPickupPoints } = require('../../utils/school.js');
const app = getApp();

const HISTORY_KEY = 'cm_pickup_history';

Page({
  data: {
    list: [],        // 当前学校的校内推荐自提点（school 云函数按用户学校下发）
    history: [],
    chosen: ''
  },

  onLoad() {
    // 高亮上次选过的自提点（wxml 用 chosen === item.name 判断 ✓）
    this.setData({ chosen: wx.getStorageSync('cm_pickup_chosen') || '' });
    this.loadHistory();
    this.loadPoints();
  },

  onShow() {
    this.loadHistory();
  },

  /** 拉取当前用户学校的推荐自提点 */
  async loadPoints() {
    try {
      const points = await getMyPickupPoints();
      this.setData({ list: points });
      if (!points.length) {
        const me = app.globalData.userInfo;
        if (!me || !me.school) {
          wx.showModal({
            title: '先选择学校',
            content: '选择学校后即可查看本校的推荐自提点',
            confirmText: '去选择',
            success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/edit-profile/edit-profile' }); }
          });
        }
      }
    } catch (e) {}
  },

  loadHistory() {
    try {
      const h = wx.getStorageSync(HISTORY_KEY) || [];
      // 去重 + 最新在前
      const uniq = [];
      const seen = new Set();
      for (let i = h.length - 1; i >= 0; i--) {
        const k = h[i];
        if (k && !seen.has(k)) { uniq.push(k); seen.add(k); }
        if (uniq.length >= 5) break;
      }
      this.setData({ history: uniq });
    } catch (e) {}
  },

  saveHistory(name) {
    if (!name) return;
    try {
      const cur = wx.getStorageSync(HISTORY_KEY) || [];
      const next = cur.concat([name]).slice(-30);
      wx.setStorageSync(HISTORY_KEY, next);
    } catch (e) {}
  },

  choose(e) {
    const name = e.currentTarget.dataset.name;
    this.saveHistory(name);
    wx.setStorageSync('cm_pickup_chosen', name);
    wx.navigateBack();
  },

  /** 使用当前位置（每次申请位置权限 wx.authorize scope.userLocation） */
  useLocation() {
    wx.authorize({
      scope: 'scope.userLocation',
      success: () => {
        wx.chooseLocation({
          success: r => {
            const name = r.name || r.address;
            if (!name) return wx.showToast({ title: '未选到位置', icon: 'none' });
            this.saveHistory(name);
            wx.setStorageSync('cm_pickup_chosen', name);
            wx.navigateBack();
          },
          fail: () => {
            wx.showToast({ title: '未选到位置', icon: 'none' });
          }
        });
      },
      fail: () => {
        wx.showModal({
          title: '需要位置权限',
          content: '用于获取当前位置作为自提点，每次使用都会询问您',
          confirmText: '去设置',
          success: r => {
            if (r.confirm) wx.openSetting();
          }
        });
      }
    });
  }
});
