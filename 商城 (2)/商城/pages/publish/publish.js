const app = getApp();
const { call } = require('../../utils/cloud.js');
const { CATEGORIES } = require('../../utils/categories.js');
const { CONDITIONS } = require('../../utils/constants.js');
const { SENSITIVE_WORDS, SENSITIVE_WORDS_VERSION } = require('../../utils/sensitive-words.js');

/** 标题+描述校验：长度 + 违禁词（与服务端 goods 云函数 checkContent 一致） */
function validateContent(title, desc) {
  const t = (title || '').trim();
  if (!t) return '请填写标题';
  if (t.length < 2 || t.length > 30) return '标题需 2~30 个字';
  const all = [title || '', desc || ''].join('\n');
  const bad = SENSITIVE_WORDS.find(w => all.indexOf(w) !== -1);
  if (bad) return `内容含违禁词「${bad}」，请修改`;
  return '';
}

console.log('[publish] sensitive-words', SENSITIVE_WORDS_VERSION, 'count:', SENSITIVE_WORDS.length);

/**
 * 发布草稿：录入一条商品要填标题/描述/价格/分类/自提点，还要选好几张图，
 * 中途切走、接电话、杀进程都会全丢。这里把「表单 + 已上传图片的 fileID」写本地，
 * 重新进入发布页时自动恢复；发布成功后清除。
 * 注意：编辑已有商品时**不写草稿**（草稿只服务「新建」，避免与编辑内容混淆）。
 */
const DRAFT_KEY = 'cm_publish_draft_v1';

Page({
  data: {
    cats: CATEGORIES, conditions: CONDITIONS,
    images: [],
    form: {
      title: '', desc: '', price: '', originalPrice: '',
      category: '', condition: 'normal', pickupPoint: '', type: 'sell'
    },
    agreed: false,
    editId: ''
  },

  onLoad(opt = {}) {
    if (opt.id) this.setData({ editId: opt.id });
    if (opt.type === 'want') this.setData({ 'form.type': 'want' });
    this._draftChecked = false;
  },

  onHide() {
    // 切 tab / 进后台前落盘草稿，防止杀进程后内容全丢
    this._saveDraft();
  },

  onShow() {
    app.syncTabBar(2); // 同步自定义 tabBar 的选中态
    // 编辑模式：发布页是 tabBar 页，无法用 navigateTo 传参，
    // 因此由来源页写入一次性缓存，这里消费后立即清除，避免脏状态
    const pendingEdit = wx.getStorageSync('cm_edit_goods_id');
    if (pendingEdit) {
      wx.removeStorageSync('cm_edit_goods_id');
      this.setData({ editId: pendingEdit });
      this.loadForEdit();
      return;
    }
    // 通过 opt.id 进来的也是编辑
    if (this.data.editId && !this._loaded) {
      this._loaded = true;
      this.loadForEdit();
      return;
    }
    if (this.data.editId) return; // 编辑中，onShow 不再做后续动作
    // 首次进入（非编辑）时恢复上次没发布完的草稿。只做一次，避免覆盖用户正在填的内容。
    if (!this._draftChecked) {
      this._draftChecked = true;
      if (this._restoreDraft()) {
        // 给「清空重填」的出口：恢复后必须能一键丢弃，否则草稿反而变成负担
        wx.showModal({
          title: '发现未发布的草稿',
          content: '已恢复上次没发布完的内容，要继续编辑吗？',
          confirmText: '继续编辑',
          cancelText: '清空重填',
          success: r => { if (!r.confirm) this.resetForm(); }
        });
      }
    }
    // 不要在这里 resetForm —— tabBar 页面 onShow 会在每次切回/从子页面返回时都触发，
    // 之前无条件 resetForm 导致选了自提点返回时整个表单被清空。form 数据只在
    // submit 成功后（或用户主动点"重置"）才清空，跨 tab 切回/从 picker 返回都保留。
    // 接收自提点选择（保留 form 其他字段，只合并这一个）
    const pickup = wx.getStorageSync('cm_pickup_chosen');
    if (pickup) {
      this.setData({ 'form.pickupPoint': pickup });
      wx.removeStorageSync('cm_pickup_chosen');
    }
    if (app.globalData.userInfo && !app.isVerified()) {
      wx.showModal({
        title: '提示',
        content: '发布前需完成学生认证，是否现在认证？',
        confirmText: '去认证', cancelText: '稍后',
        success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/verify/verify' }); }
      });
    }
  },

  /** 重置为初始空表单（用于「去发布」/ 重新进入发布 tab 时清掉上次残留） */
  resetForm() {
    // 注意补上 type：此前重置后的 form 没有 type 字段 → form.type 变成 undefined，
    // 「出售/求购」切换态会显示异常。
    this.setData({
      images: [],
      form: { title: '', desc: '', price: '', originalPrice: '', category: '', condition: 'normal', pickupPoint: '', type: 'sell' },
      agreed: false,
      editId: '',
      _loaded: false
    });
    this._clearDraft();
  },

  /** 保存草稿到本地（表单 + 已上传图片 fileID）。编辑模式不写，内容为空时不写。 */
  _saveDraft() {
    if (this.data.editId) return;
    const { form, images, agreed } = this.data;
    const f = form || {};
    const empty = !f.title && !f.desc && !f.price && !f.originalPrice
      && !f.category && !f.pickupPoint && !(images && images.length);
    try {
      if (empty) { wx.removeStorageSync(DRAFT_KEY); return; }
      wx.setStorageSync(DRAFT_KEY, { form: f, images: (images || []).slice(), agreed: !!agreed, at: Date.now() });
    } catch (e) {}
  },

  /**
   * 恢复草稿。只在「首次进入 + 非编辑」时调用一次，避免覆盖用户正在填的内容。
   * @returns {boolean} 是否成功恢复
   */
  _restoreDraft() {
    try {
      const d = wx.getStorageSync(DRAFT_KEY);
      if (!d || !d.form) return false;
      const f = d.form;
      const hasContent = f.title || f.desc || f.price || f.originalPrice || f.category
        || f.pickupPoint || ((d.images || []).length > 0);
      if (!hasContent) return false;
      this.setData({
        form: {
          title: f.title || '', desc: f.desc || '', price: f.price || '',
          originalPrice: f.originalPrice || '', category: f.category || '',
          condition: f.condition || 'normal', pickupPoint: f.pickupPoint || '',
          type: f.type || 'sell'
        },
        images: (d.images || []).slice(),
        agreed: !!d.agreed
      });
      return true;
    } catch (e) { return false; }
  },

  _clearDraft() {
    try { wx.removeStorageSync(DRAFT_KEY); } catch (e) {}
  },

  chooseImage() {
    const remain = 9 - this.data.images.length;
    wx.chooseImage({
      count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: res => {
        // ① 先本地压缩（长边 1080px / 质量 80）→ ② 再并行上传。
        // 相机直出原图常 2-5MB，是列表/详情页图片加载慢的主因；压完通常只剩 100-300KB。
        wx.showLoading({ title: '处理中…', mask: true });
        Promise.all(res.tempFilePaths.map(p => this._compress(p)))
          .then(paths => {
            wx.showLoading({ title: '上传中…', mask: true });
            return Promise.all(paths.map((p, idx) => {
              const ext = (p.match(/\.(\w+)$/) || [, 'jpg'])[1];
              const cloudPath = `goods/wxu-${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
              // 统一适配器上传（本地后端/云存储自动切换）
              const { upFile } = require('../../utils/cloud.js');
              return upFile({ cloudPath, filePath: p });
            }));
          })
          .then(fileIds => {
            wx.hideLoading();
            this.setData({ images: this.data.images.concat(fileIds) }, () => this._saveDraft());
          })
          .catch(e => {
            wx.hideLoading();
            wx.showToast({ title: '图片上传失败', icon: 'none' });
            console.error(e);
          });
      }
    });
  },

  /**
   * PNG 兜底重编码为 JPEG。
   * wx.compressImage 的 quality **只对 JPG 生效**，PNG（截屏/表情包）会被原样保留 ——
   * 用户选一张 2560x1440 的 PNG 就是 4~6MB。这里用离屏 canvas 重绘后导出 JPEG
   * （长边 1280、质量 0.85），通常能降到 100~300KB。
   * 任何一步失败都回退原路径，**绝不阻断发布**。
   */
  _reencodeJpeg(src) {
    return new Promise(resolve => {
      const bail = (why, e) => { if (why) console.warn('[publish] 转 JPEG 跳过:', why, e || ''); resolve(src); };
      if (!wx.createOffscreenCanvas) return bail('不支持离屏 canvas');
      wx.getImageInfo({
        src,
        success: info => {
          const w0 = Number(info.width) || 0, h0 = Number(info.height) || 0;
          if (!w0 || !h0) return bail('读不到图片尺寸');
          const MAX = 1280;
          const scale = Math.min(1, MAX / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
          try {
            const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
            const ctx = canvas.getContext('2d');
            // JPEG 无透明通道 → 先铺白底，避免透明区域被压成黑块
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            const img = canvas.createImage();
            img.onload = () => {
              ctx.drawImage(img, 0, 0, w, h);
              wx.canvasToTempFilePath({
                canvas, fileType: 'jpg', quality: 0.85, destWidth: w, destHeight: h,
                success: r => resolve((r && r.tempFilePath) || src),
                fail: e => bail('canvasToTempFilePath 失败', e)
              });
            };
            img.onerror = e => bail('图片解码失败', e);
            img.src = src;
          } catch (e) { bail('canvas 异常', e); }
        },
        fail: e => bail('getImageInfo 失败', e)
      });
    });
  },

  /**
   * 压缩单张图：① wx.compressImage（长边 1080 / 质量 80）；
   * ② 若结果仍 > 800KB（说明是 PNG，quality 没生效）→ 再走 canvas 转 JPEG。
   * 失败一律回退原图，不阻断发布。
   */
  async _compress(src) {
    const step1 = await new Promise(resolve => {
      if (!wx.compressImage) return resolve(src);
      wx.compressImage({
        src,
        quality: 80,
        compressedWidth: 1080,
        success: r => resolve((r && r.tempFilePath) || src),
        fail: err => { console.warn('compressImage fail', err); resolve(src); }
      });
    });
    try {
      const size = await new Promise(resolve => {
        wx.getFileInfo({ filePath: step1, success: r => resolve(Number(r.size) || 0), fail: () => resolve(0) });
      });
      if (size > 800 * 1024) {
        console.log('[publish] 压缩后仍 ' + Math.round(size / 1024) + 'KB，尝试转 JPEG');
        const jpg = await this._reencodeJpeg(step1);
        if (jpg && jpg !== step1) {
          const jsize = await new Promise(resolve => {
            wx.getFileInfo({ filePath: jpg, success: r => resolve(Number(r.size) || 0), fail: () => resolve(0) });
          });
          // 只有确实更小才采用 JPEG —— 实测高频噪点/截图类图转 JPEG 反而会变大，
          // 这里「取更小者」保证该优化只会更好、绝不会让上传变大。
          if (jsize > 0 && jsize < size) {
            console.log('[publish] 转 JPEG 生效：' + Math.round(size / 1024) + 'KB → ' + Math.round(jsize / 1024) + 'KB');
            return jpg;
          }
          if (jsize > 0) console.log('[publish] JPEG 反而更大（' + Math.round(jsize / 1024) + 'KB），保留原格式');
        }
      }
    } catch (e) {}
    return step1;
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.index;
    const arr = this.data.images.slice();
    arr.splice(idx, 1);
    this.setData({ images: arr }, () => this._saveDraft());
  },

  onTitle(e) { this.setData({ 'form.title': e.detail.value }, () => this._saveDraft()); },
  onDesc(e) { this.setData({ 'form.desc': e.detail.value }, () => this._saveDraft()); },
  onPrice(e) { this.setData({ 'form.price': e.detail.value }, () => this._saveDraft()); },
  onOrigPrice(e) { this.setData({ 'form.originalPrice': e.detail.value }, () => this._saveDraft()); },
  selectCat(e) { this.setData({ 'form.category': e.currentTarget.dataset.key }, () => this._saveDraft()); },
  selectCond(e) { this.setData({ 'form.condition': e.currentTarget.dataset.value }, () => this._saveDraft()); },
  setType(e) {
    const t = e.currentTarget.dataset.type; // 'sell' | 'want'
    if (t === this.data.form.type) return;
    this.setData({ 'form.type': t }, () => this._saveDraft());
  },

  choosePickup() { wx.navigateTo({ url: '/pages/pickup/pickup' }); },

  toggleAgree() { this.setData({ agreed: !this.data.agreed }, () => this._saveDraft()); },
  goAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }); },

  async loadForEdit() {
    try {
      await app.initUser();
      const myOpenid = app.globalData.openid;
      if (!myOpenid) { wx.showToast({ title: '请先登录', icon: 'none' }); this.resetForm(); return; }
      const g = await call('goods', { action: 'detail', id: this.data.editId }, { silent: true, loading: false });
      // 权限前置：非自己的商品不能编辑（前端兜底，云端 goods.update 还会再校验一次）
      if (!g || g._openid !== myOpenid) {
        wx.showModal({
          title: '无权编辑',
          content: '这不是你发布的商品，无法编辑',
          showCancel: false,
          confirmText: '知道了',
          success: () => {
            this.setData({ editId: '' });
            this.resetForm();
          }
        });
        return;
      }
      this.setData({
        images: (g.images || []).slice(),
        form: {
          title: g.title || '', desc: g.desc || '',
          price: String(g.price || ''), originalPrice: g.originalPrice ? String(g.originalPrice) : '',
          category: g.category || '', condition: g.condition || 'normal',
          pickupPoint: g.pickupPoint || '', type: g.type || 'sell'
        },
        agreed: true
      });
    } catch (e) {
      wx.showToast({ title: '商品加载失败', icon: 'none' });
    }
  },

  async submit() {
    const { form, images, agreed } = this.data;
    // 多校隔离：未选学校不能发布（服务端也会拦截，这里前置引导）
    const me = app.globalData.userInfo;
    if (!this.data.editId && !(me && me.school)) {
      return wx.showModal({
        title: '先选择学校',
        content: '发布前请先在「个人资料」中选择你的学校，商品只对同校同学展示',
        confirmText: '去选择',
        success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/edit-profile/edit-profile' }); }
      });
    }
    const contentErr = validateContent(form.title, form.desc);
    if (contentErr) return wx.showToast({ title: contentErr, icon: 'none' });
    if (!form.category) return wx.showToast({ title: '请选择分类', icon: 'none' });
    const isWant = form.type === 'want';
    if (!isWant && !images.length) return wx.showToast({ title: '请至少上传一张图', icon: 'none' });
    if (!isWant && !form.price) return wx.showToast({ title: '请填写价格', icon: 'none' });
    if (!isWant && Number(form.price) <= 0) return wx.showToast({ title: '价格必须大于 0', icon: 'none' });
    if (isWant && form.price && Number(form.price) <= 0) return wx.showToast({ title: '预算须大于 0', icon: 'none' });
    if (!agreed) return wx.showToast({ title: '请先同意发布协议', icon: 'none' });

    // 低信用分限制发布（协议 6.3：低于 60 分暂停发布；服务端还有兜底校验）
    if (this.data.editId) {
      // 编辑已有商品不受信用分限制（不新增占用）
    } else {
      const credit = app.globalData.userInfo && app.globalData.userInfo.credit;
      if (credit != null && credit < 60) {
        wx.showModal({
          title: '暂时不能发布',
          content: `您当前信用分 ${credit} 分（低于 60 分已被暂停发布）。完成好评可恢复信用分。`,
          confirmText: '查看信用分', cancelText: '知道了',
          success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/credit/credit' }); }
        });
        return;
      }
    }

    const title = form.title.trim();

    // 防重复发布：慢网络下连点会并发调 publish，产生两条重复商品（编辑模式同理）
    if (this._submitting) return;
    this._submitting = true;

    try {
      if (this.data.editId) {
        await call('goods', {
          action: 'update', id: this.data.editId,
          patch: {
            title, desc: form.desc, images,
            price: form.price, originalPrice: form.originalPrice,
            category: form.category, condition: form.condition,
            pickupPoint: form.pickupPoint
          }
        });
        wx.setStorageSync('cm_home_dirty', Date.now()); // 改价/改分类后首页强制刷新
        wx.showToast({ title: '修改成功', icon: 'success' });
        // 发布页是 tabBar 页，reLaunch 进来时没有上级页面可返回
        setTimeout(() => wx.reLaunch({ url: '/pages/sold/sold?status=onSale' }), 800);
      } else {
        await call('goods', {
          action: 'publish',
          title, desc: form.desc, images,
          price: form.price, originalPrice: form.originalPrice,
          category: form.category, condition: form.condition,
          pickupPoint: form.pickupPoint, type: form.type
          // campus 由服务端按卖家资料（users.school）打标，客户端不传
        });
        // 发布成功后清空 form（之前 resetForm 误放在 onShow 已删除）
        this.resetForm();
        // 标记首页列表脏：本机刚发布，回到首页时跳过 60s 节流强制刷新，
        // 审核通过后（onSale）能立刻在首页看到，不必等节流窗口。
        wx.setStorageSync('cm_home_dirty', Date.now());
        // 新商品先进入「待审核」（status=pending），而首页只展示 onSale。
        // 若仍只提示「发布成功」然后跳首页，用户会发现商品「哪里都没有」→ 以为没保存。
        // 改为明确说明审核流程，并直接把用户带到「我的商品 · 审核中」看到自己刚提交的商品。
        wx.showModal({
          title: '已提交审核',
          content: '商品已保存。审核通过后会自动上架到首页，你可以在「我的商品 · 审核中」查看进度。',
          showCancel: false,
          confirmText: '查看',
          complete: () => wx.reLaunch({ url: '/pages/sold/sold?status=pending' })
        });
      }
    } catch (e) {
      // 之前这里 swallow 掉了所有错误，用户只看到"网络异常"，根本不知道为啥失败。
      // 改成：① 弹具体消息 ② 写进 data.submitError 供真机自动化脚本读取
      console.error('publish/submit fail', e);
      const msg = (e && e.msg) || '发布失败，请稍后再试';
      this.setData({ submitError: msg });
      wx.showToast({ title: msg, icon: 'none', duration: 3000 });
      this._submitting = false; // 失败要解锁，否则用户无法重试
    }
  }
});
