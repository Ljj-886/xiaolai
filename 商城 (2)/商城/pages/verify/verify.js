const app = getApp();
const { call } = require('../../utils/cloud.js');
const { getSchools } = require('../../utils/school.js');

Page({
  data: {
    user: {},
    form: { realName: '', studentId: '', school: '', education: '专科' },
    educations: ['专科', '本科', '硕士', '博士'],
    educationIndex: 0,
    evidence: [],
    schoolNames: [], // 兼容字段：完整列表（保留旧字段避免影响他人）
    schoolNamesFull: [], // 完整学校列表（教育部 2868 所 + 兜底）
    schoolSuggestions: [], // 当前输入下的候选（最多 10 条）
    schoolFocused: false, // input 聚焦状态：true 时才显示候选
    exactMatch: false, // 当前 form.school 是否精确匹配列表中某项
    formDirty: false, // 用户已手动编辑未提交：onShow 的 fetchMe 不再回填，避免冲掉输入
    eduOpen: false, // 学历下拉是否展开
    agreed: false // 是否已明示同意《用户协议》《隐私政策》并授权处理学籍证明
  },

  onLoad() {
    this.loadSchools();
  },

  async loadSchools() {
    const list = await getSchools();
    // 取纯名字数组 + 含 level 的对象数组（picker 兼容 + 候选展示用）
    const flat = list.map(s => ({
      name: String(s.name || '').trim(),
      level: String(s.level || '').trim()
    })).filter(s => s.name);
    // 已选学校不在清单里（手动填过 / 历史自由输入）时补到首条
    const cur = this.data.form.school;
    let namesOnly = flat.map(s => s.name);
    if (cur && !namesOnly.includes(cur)) {
      flat.unshift({ name: cur, level: '' });
      namesOnly = [cur, ...namesOnly];
    }
    this.setData({
      schoolNames: namesOnly,
      schoolNamesFull: flat
    });
    // 预建小写索引（放在实例字段而非 data，避免 setData 多传 2868 条字符串）。
    // 输入过滤时直接查这个数组，省掉每次按键对 2868 个名字调用 toLowerCase()。
    this._schoolLower = flat.map(s => String(s.name || '').toLowerCase());
  },

  onShow() {
    this.fetchMe();
  },

  async fetchMe(skipPrefill) {
    try {
      const me = await call('user', { action: 'me' }, { silent: true, loading: false });
      this.setData({ user: me });
      app.globalData.userInfo = me;
      // 提交成功后传 true：只刷新顶部状态（显示"审核中/已认证"），不再回填表单
      // 用户已手动改过（formDirty）也跳过回填，避免离开页面截完图返回时把输入冲掉
      if (skipPrefill || this.data.formDirty) return;
      // 预填已有认证信息（已认证用户修改 / 被驳回后重填都方便）
      const src = (me && me.verifyApply && (me.verifyApply.status === 'pending' || me.verifyApply.status === 'rejected'))
        ? me.verifyApply : me;
      if (src) {
        const form = { ...this.data.form };
        if (src.realName) form.realName = src.realName;
        if (src.studentId) form.studentId = src.studentId;
        if (src.school) form.school = src.school;
        if (src.education) {
          form.education = src.education;
          const idx = this.data.educations.indexOf(src.education);
          if (idx !== -1) this.setData({ educationIndex: idx });
        }
        this.setData({ form });
      }
    } catch (e) {}
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [`form.${k}`]: e.detail.value, formDirty: true });
  },

  onEducationChange(e) {
    // 兼容旧 picker 调用（已被自定义下拉替代，保留以防模板残留）
    const i = Number(e.detail.value);
    this.setData({
      educationIndex: i,
      'form.education': this.data.educations[i],
      formDirty: true
    });
  },

  /** 学历下拉：点输入框展开/收起 */
  toggleEdu() {
    this.setData({ eduOpen: !this.data.eduOpen });
  },

  /** 学历下拉：选中某项后回填 + 收起 */
  pickEdu(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({
      educationIndex: idx,
      'form.education': this.data.educations[idx],
      eduOpen: false,
      formDirty: true
    });
  },

  /**
   * 学校 input 实时输入：
   * - 同步写入 form.school（用户输入即保留，失焦/提交不丢）
   * - 过滤 schoolNamesFull 实时给候选（最多 10 条；空串时给前 10 条）
   * - 计算 exactMatch 用于"使用不在列表的名称"提示
   */
  onSchoolInput(e) {
    const q = String(e.detail.value || '').trim();
    // 同步写入 form（不能防抖：用户可能立即失焦/提交，值不能丢）
    this.setData({ 'form.school': q, schoolFocused: true, formDirty: true });
    // 候选计算防抖：schoolNamesFull 有 ~2868 所，逐字做全量扫描 + localeCompare 排序会掉帧。
    // 只把「算候选」推迟到停止输入 180ms 后，「写值」保持同步。
    if (this._schoolTimer) clearTimeout(this._schoolTimer);
    this._schoolTimer = setTimeout(() => {
      this._schoolTimer = null;
      this._computeSchoolSuggestions(q);
    }, 180);
  },

  /** 计算学校候选项（防抖后执行，读预建的小写索引，避免逐字 toLowerCase 全量） */
  _computeSchoolSuggestions(q) {
    const full = this.data.schoolNamesFull;
    const lower = this._schoolLower || [];
    let suggestions;
    let exact = false;
    if (!q) {
      suggestions = full.slice(0, 10);
    } else {
      const qLower = q.toLowerCase();
      const hit = [];
      for (let i = 0; i < full.length && hit.length < 20; i++) {
        const s = full[i];
        if (s.name === q) { exact = true; continue; }
        if (s.name.includes(q) || String(lower[i] || '').includes(qLower)) hit.push(s);
      }
      // 优先展示"以 q 开头"的，其他排后；再按名字排序
      hit.sort((a, b) => {
        const aStart = a.name.startsWith(q) ? 0 : 1;
        const bStart = b.name.startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return a.name.localeCompare(b.name, 'zh');
      });
      suggestions = hit.slice(0, 10);
    }
    this.setData({ schoolSuggestions: suggestions, exactMatch: exact });
  },

  onSchoolFocus() {
    // 聚焦时给一份默认候选（用户能直接看到热门学校 + 提示可手动输入）
    const full = this.data.schoolNamesFull;
    const cur = String(this.data.form.school || '').trim();
    let suggestions;
    if (cur) {
      const q = cur;
      const qLower = q.toLowerCase();
      const hit = [];
      for (let i = 0; i < full.length && hit.length < 20; i++) {
        const s = full[i];
        if (s.name === q) continue;
        if (s.name.includes(q) || s.name.toLowerCase().includes(qLower)) hit.push(s);
      }
      hit.sort((a, b) => {
        const aStart = a.name.startsWith(q) ? 0 : 1;
        const bStart = b.name.startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return a.name.localeCompare(b.name, 'zh');
      });
      suggestions = hit.slice(0, 10);
    } else {
      suggestions = full.slice(0, 10);
    }
    this.setData({
      schoolFocused: true,
      schoolSuggestions: suggestions,
      exactMatch: !!cur && full.some(s => s.name === cur)
    });
  },

  onSchoolBlur() {
    // 延迟收起候选——给用户点选 candidate 留时间（catchtap 已阻止冒泡）
    setTimeout(() => {
      this.setData({ schoolFocused: false });
    }, 200);
  },

  pickSuggestion(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({
      'form.school': name,
      schoolSuggestions: [],
      schoolFocused: false,
      exactMatch: true,
      formDirty: true
    });
  },

  /** 用户输入了但列表里没有——确认用输入值 */
  pickManual() {
    this.setData({
      schoolSuggestions: [],
      schoolFocused: false
    });
  },

  clearSchool() {
    this.setData({
      'form.school': '',
      schoolSuggestions: this.data.schoolNamesFull.slice(0, 10),
      schoolFocused: true,
      exactMatch: false,
      formDirty: true
    });
  },

  chooseImg() {
    const remain = 3 - this.data.evidence.length;
    if (remain <= 0) return;
    wx.chooseImage({ count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: r => this.setData({ evidence: this.data.evidence.concat(r.tempFilePaths) })
    });
  },

  removeImg(e) {
    const i = e.currentTarget.dataset.index;
    const arr = this.data.evidence.slice();
    arr.splice(i, 1);
    this.setData({ evidence: arr });
  },

  previewEvidence(e) {
    const { index } = e.currentTarget.dataset;
    wx.previewImage({ urls: this.data.evidence, current: this.data.evidence[index] });
  },

  /** 跳转学信网：在浏览器打开学信网在线学籍验证报告生成页（用户自行截图） */
  goChsi() {
    wx.showModal({
      title: '前往学信网',
      content: '将打开「学信网」在线学籍验证报告页面（建议收藏：chsi.com.cn）。\n登录后在「在线验证」-「学籍验证」中生成报告并截图保存到相册，再回到本页面上传。',
      confirmText: '前往',
      success: r => {
        if (r.confirm) {
          wx.setClipboardData({
            data: 'https://www.chsi.com.cn/xlrz/index.jsp',
            success: () => wx.showToast({ title: '学信网链接已复制，去浏览器粘贴打开', icon: 'none' })
          });
        }
      }
    });
  },

  // 明示同意：点击整行或复选框切换
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  async submit() {
    const { form, evidence } = this.data;
    if (!this.data.agreed) {
      return wx.showToast({ title: '请先阅读并同意《用户协议》与《隐私政策》', icon: 'none' });
    }
    if (!form.realName || !form.studentId || !form.school) {
      return wx.showToast({ title: '请填写完整信息', icon: 'none' });
    }
    if (!form.education) {
      return wx.showToast({ title: '请选择学历', icon: 'none' });
    }
    if (!evidence.length) {
      return wx.showToast({ title: '请上传学信网学籍验证截图', icon: 'none' });
    }
    // 防重复提交：连点会上传两遍凭证并写入两条申请（上传本身也要钱/时间）
    if (this._submitting) return;
    this._submitting = true;
    // 已认证用户修改认证 → 二次确认
    if (this.data.user.verified) {
      const confirmed = await new Promise(res => {
        wx.showModal({
          title: '重新提交认证',
          content: '将把修改后的认证信息交给管理员重新审核。审核通过前，你现有的认证仍然有效。',
          success: r => res(r.confirm)
        });
      });
      if (!confirmed) { this._submitting = false; return; }
    }
    wx.showLoading({ title: '上传凭证中…', mask: true });
    try {
      const fileIDs = [];
      for (let i = 0; i < evidence.length; i++) {
        const ext = (evidence[i].split('.').pop() || 'jpg').toLowerCase();
        const cloudPath = 'verify/' + OPENID_HINT() + '_' + Date.now() + '_' + i + '.' + ext;
        // 统一适配器上传（本地后端/云存储自动切换）
        const { upFile } = require('../../utils/cloud.js');
        const fileUrl = await upFile({ cloudPath, filePath: evidence[i] });
        if (fileUrl) fileIDs.push(fileUrl);
      }
      if (!fileIDs.length) throw new Error('凭证上传失败');
      await call('user', {
        action: 'applyVerify',
        realName: form.realName, studentId: form.studentId,
        school: form.school,
        education: form.education,
        evidence: fileIDs,
        // 同意留痕：写入申请记录，便于事后证明已取得明示同意
        agreed: true, agreedAt: Date.now()
      });
      wx.hideLoading();
      wx.showToast({ title: '已提交，请等待审核', icon: 'success' });
      // 提交成功后清空表单与凭证，避免刚填的信息残留（fetchMe 用 skipPrefill 只刷新状态）
      // agreed 一并重置：再次提交需重新取得明示同意
      this.setData({
        form: { realName: '', studentId: '', school: '', education: '专科' },
        educationIndex: 0,
        evidence: [],
        formDirty: false,
        agreed: false
      });
      this.fetchMe(true);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
      this._submitting = false; // 失败要解锁，否则用户无法重试
    }
  }
});

// 仅用于文件路径，不暴露给云函数
function OPENID_HINT() {
  const app = getApp();
  return (app && app.globalData && app.globalData.openid) || 'anon';
}
