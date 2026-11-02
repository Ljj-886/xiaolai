const { call } = require('../../utils/cloud.js');
const { getSchools } = require('../../utils/school.js');
const { ensureCloudAvatar } = require('../../utils/avatar.js');
const app = getApp();

Page({
  data: {
    form: { nickName: '', avatarUrl: '', gender: '', school: '' },
    genderIndex: 0,
    genders: ['未设置', '男', '女'],
    schoolNames: [],
    verified: false,
    school: '',
    studentId: '',
    realName: '',
    loading: true,
    defaultAvatar: '/images/avatar-default.png',
    avatarErr: false,
    formDirty: false // 用户已手动编辑未保存：onShow 的 fetchMe 不再回填，避免冲掉输入
  },

  /** 头像加载失败 → 回退默认头像（必须同时改 src，否则永久空白） */
  onAvatarErr() {
    if (this.data.avatarErr) return;
    this.setData({ avatarErr: true });
  },

  onShow() {
    this.loadSchools();
    this.fetchMe();
  },

  async loadSchools() {
    const list = await getSchools();
    const names = list.map(s => s.name);
    // 兼容老数据：已填学校不在清单（历史自由输入）时追加，避免显示丢失
    if (this.data.form.school && !names.includes(this.data.form.school)) names.unshift(this.data.form.school);
    this.setData({ schoolNames: names });
  },

  /** 选择学校（未认证用户；多校隔离的商品流以此为准） */
  onPickSchool(e) {
    const name = this.data.schoolNames[Number(e.detail.value)];
    if (name) this.setData({ 'form.school': name, formDirty: true });
  },

  async fetchMe() {
    this.setData({ loading: true });
    try {
      const me = await call('user', { action: 'me' }, { silent: true, loading: false });
      const gender = me.gender || '';
      const genderIndex = gender === '男' ? 1 : gender === '女' ? 2 : 0;
      // 用户已改过未保存 → 只刷新顶部/展示信息，绝不覆盖正在编辑的表单
      if (this.data.formDirty) {
        this.setData({
          genderIndex,
          verified: !!me.verified,
          school: me.school || '',
          studentId: me.studentId || '',
          realName: me.realName || '',
          loading: false
        });
        return;
      }
      this.setData({
        form: {
          nickName: me.nickName || '',
          avatarUrl: me.avatarUrl || '',
          gender,
          school: me.school || ''
        },
        genderIndex,
        verified: !!me.verified,
        school: me.school || '',
        studentId: me.studentId || '',
        realName: me.realName || '',
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [`form.${k}`]: e.detail.value, formDirty: true });
  },

  /** 微信原生头像选择（open-type=chooseAvatar，所有人可改） */
  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (!url) return;
    this.setData({ 'form.avatarUrl': url, formDirty: true });
  },

  /** 从相册/拍照选图 → 上传到云存储 */
  chooseFromAlbum() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: async r => {
        const path = r.tempFiles[0].tempFilePath;
        try {
          const cloudPath = `avatar/${app.globalData.openid}_${Date.now()}.jpg`;
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: path });
          this.setData({ 'form.avatarUrl': up.fileID, formDirty: true });
        } catch (e) {
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      }
    });
  },

  /** 性别选择（picker） */
  onPickGender(e) {
    const idx = Number(e.detail.value);
    const gender = idx === 0 ? '' : idx === 1 ? '男' : '女';
    this.setData({ genderIndex: idx, 'form.gender': gender, formDirty: true });
  },

  /** 已认证用户：跳转校园认证页修改学校/学号 */
  goVerify() {
    wx.navigateTo({ url: '/pages/verify/verify' });
  },

  async save() {
    const { nickName } = this.data.form;
    if (!nickName || !String(nickName).trim()) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    if (this._saving) return; // 防连点：重复提交会重复上传头像并多次写入资料
    this._saving = true;
    try {
      // 头像：wx.chooseAvatar 返回 http://tmp/... 临时路径会过期，必须先上传到云存储
      let avatarUrl = this.data.form.avatarUrl;
      if (avatarUrl && !avatarUrl.startsWith('cloud://')) {
        wx.showLoading({ title: '上传头像…', mask: true });
        try {
          avatarUrl = await ensureCloudAvatar(avatarUrl);
        } finally {
          wx.hideLoading();
        }
        if (!avatarUrl) { this._saving = false; return wx.showToast({ title: '头像上传失败，请重试', icon: 'none' }); }
      }
      const payload = { ...this.data.form, avatarUrl };
      // 不再把空字符串 avatarUrl 发到后端（避免被显式存为 ''）
      if (!payload.avatarUrl) delete payload.avatarUrl;
      await call('user', { action: 'updateProfile', ...payload });
      // 同步更新本地缓存，避免其他页面拿到旧值
      app.globalData.userInfo = { ...(app.globalData.userInfo || {}), ...this.data.form, avatarUrl };
      this.setData({ formDirty: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      // call() 内部已经 toast；这里兜底
      this._saving = false;
    }
  }
});
