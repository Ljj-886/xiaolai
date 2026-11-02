const { call } = require('../../utils/cloud.js');
const { REPORT_REASONS } = require('../../utils/constants.js');
const { chooseAndUpload } = require('../../utils/upload.js');

Page({
  data: {
    targetType: 'goods', targetId: '',
    reason: '', desc: '', images: [],
    REASONS: REPORT_REASONS
  },

  onLoad(opt) {
    this.setData({ targetType: opt.targetType || 'goods', targetId: opt.targetId || '' });
  },

  select(e) { this.setData({ reason: e.currentTarget.dataset.r }); },
  onInput(e) { this.setData({ desc: e.detail.value }); },

  // 选图并上传（统一走 utils/upload.js，避免各页重复实现）
  async choose() {
    const remain = 3 - this.data.images.length;
    try {
      const ids = await chooseAndUpload({ dir: 'report', remain });
      if (ids.length) this.setData({ images: this.data.images.concat(ids) });
    } catch (e) { /* 失败提示已在 chooseAndUpload 内统一处理 */ }
  },
  remove(e) {
    const i = e.currentTarget.dataset.index;
    const arr = this.data.images.slice(); arr.splice(i, 1);
    this.setData({ images: arr });
  },

  async submit() {
    if (!this.data.reason) return wx.showToast({ title: '请选择举报原因', icon: 'none' });
    if (!this.data.desc) return wx.showToast({ title: '请填写说明', icon: 'none' });
    if (this._submitting) return; // 防重复提交：连点会写多条重复举报
    this._submitting = true;
    try {
      await call('user', {
        action: 'report',
        targetType: this.data.targetType,
        targetId: this.data.targetId,
        reason: this.data.reason,
        desc: this.data.desc,
        images: this.data.images
      });
      wx.showToast({ title: '已提交，感谢反馈', icon: 'success' });
      setTimeout(() => {
        // 直接打开举报页时没有上级页面可返回，兜底回首页
        if (getCurrentPages().length > 1) wx.navigateBack();
        else wx.switchTab({ url: '/pages/index/index' });
      }, 1200);
    } catch (e) { this._submitting = false; }
  }
});
