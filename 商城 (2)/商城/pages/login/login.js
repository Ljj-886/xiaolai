const app = getApp();
const { call } = require('../../utils/cloud.js');
const { ensureCloudAvatar } = require('../../utils/avatar.js');
// 学校选项已从登录面板移除：登录只收头像+昵称，学校在「学生认证」环节提交
// 学信网截图后由管理员人工审核确认（见 pages/verify/verify.js 与 cloudfunctions/user/index.js
// 的 applyVerify）。这里不再 require utils/school.js 避免不必要的 2868 所名单加载。

const AGREE_KEY = 'cm_agreed_v1';

Page({
  data: {
    showAuth: false, // 统一授权面板（头像+昵称）
    avatarUrl: '',
    nickName: '',
    // school 字段已移除：登录不收集学校，在「学生认证」环节提交学信网截图后由管理员人工审核确认
    agreed: false, // 是否已同意《用户协议》《隐私政策》
    loading: false
  },

  onLoad() {
    // 同意过则不再重复弹勾选，但协议链接常驻可查
    this.setData({ agreed: wx.getStorageSync(AGREE_KEY) === '1' });
  },

  onShow() {
    // 已是登录态（本地标记存在）则直接返回上一页；退出登录后标记被清除，不会误判
    if (wx.getStorageSync('cm_logged') === '1' && app.globalData.openid) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
    }
  },

  noop() {},

  /** 点击「登录」：弹出统一授权面板（头像+昵称） */
  openAuth() {
    this.setData({ showAuth: true });
  },

  closeAuth() {
    if (this.data.loading) return;
    this.setData({ showAuth: false });
  },

  /** 微信原生选择头像（弹出：用微信头像/从相册选择/拍照） */
  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (url) this.setData({ avatarUrl: url });
  },

  /** 微信原生获取昵称（input type="nickname"） */
  onNickInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  /** 协议同意：点击整行或复选框切换，选择结果本地留存 */
  toggleAgree() {
    const agreed = !this.data.agreed;
    wx.setStorageSync(AGREE_KEY, agreed ? '1' : '0');
    this.setData({ agreed });
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  /** 面板内「授权并登录」：头像+昵称必填；学校由后续学生认证环节人工审核确认 */
  async submitLogin() {
    const { avatarUrl, nickName, loading, agreed } = this.data;
    if (loading) return;
    if (!agreed) return wx.showToast({ title: '请先阅读并同意《用户协议》与《隐私政策》', icon: 'none' });
    if (!avatarUrl) return wx.showToast({ title: '请先选择微信头像', icon: 'none' });
    if (!nickName || !nickName.trim()) return wx.showToast({ title: '请填写微信昵称', icon: 'none' });
    this.setData({ loading: true });
    try {
      // 关键：wx.chooseAvatar 返回的是 http://tmp/... 临时路径，几天后会过期导致头像变灰。
      // 必须先上传到云存储拿到永久 cloud:// fileID，再存进数据库。
      wx.showLoading({ title: '上传头像…', mask: true });
      const cloudAvatarUrl = await ensureCloudAvatar(avatarUrl);
      wx.hideLoading();
      if (!cloudAvatarUrl) {
        this.setData({ loading: false });
        return wx.showToast({ title: '头像上传失败，请重试', icon: 'none' });
      }
      await call('user', { action: 'updateProfile', avatarUrl: cloudAvatarUrl, nickName: nickName.trim() });
      wx.setStorageSync('cm_logged', '1');
      app.globalData.userInfo = {
        ...(app.globalData.userInfo || {}),
        avatarUrl: cloudAvatarUrl, nickName: nickName.trim()
      };
      this.setData({ loading: false, showAuth: false });
      this.completeLogin();
    } catch (e) {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '登录失败', icon: 'none' });
    }
  },

  /** 完成登录，跳回上一页或首页 */
  completeLogin() {
    wx.setStorageSync('cm_logged', '1'); // 显式登录标记（退出登录时清除）
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: '/pages/mine/mine' });
    }, 600);
  }
});
