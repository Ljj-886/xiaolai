const { call } = require('../../utils/cloud.js');
const { chooseAndUpload } = require('../../utils/upload.js');

const KINDS = [
  { key: 'suggest', name: '功能建议' },
  { key: 'bug', name: '体验问题' },
  { key: 'report', name: '违规举报' },
  { key: 'other', name: '其他' }
];

Page({
  data: {
    KINDS,
    kind: 'suggest',
    content: '',
    contact: '',
    images: [],
    submitting: false
  },

  selectKind(e) { this.setData({ kind: e.currentTarget.dataset.k }); },
  onContent(e) { this.setData({ content: e.detail.value }); },
  onContact(e) { this.setData({ contact: e.detail.value }); },

  // 选图并上传（统一走 utils/upload.js）
  async choose() {
    const remain = 3 - this.data.images.length;
    if (remain <= 0) return;
    try {
      const ids = await chooseAndUpload({ dir: 'feedback', remain });
      if (ids.length) this.setData({ images: this.data.images.concat(ids) });
    } catch (e) { /* 失败提示已在 chooseAndUpload 内统一处理 */ }
  },
  remove(e) {
    const arr = this.data.images.slice();
    arr.splice(e.currentTarget.dataset.index, 1);
    this.setData({ images: arr });
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.content.trim()) return wx.showToast({ title: '请填写反馈内容', icon: 'none' });
    this.setData({ submitting: true });
    try {
      await call('feedback', {
        action: 'submit',
        kind: this.data.kind,
        content: this.data.content,
        contact: this.data.contact,
        images: this.data.images
      }, { title: '提交中' });
      wx.showToast({ title: '已提交，感谢反馈', icon: 'success' });
      setTimeout(() => {
        if (getCurrentPages().length > 1) wx.navigateBack();
        else wx.switchTab({ url: '/pages/mine/mine' });
      }, 1200);
    } catch (e) {
      this.setData({ submitting: false });
    }
  }
});
