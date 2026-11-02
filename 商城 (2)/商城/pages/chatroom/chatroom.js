const { call } = require('../../utils/cloud.js');
const { formatTime } = require('../../utils/util.js');
const app = getApp();

// 表情分组（每组最多 30 个；微信小程序无法读取用户系统表情包，所以内置 + 用户历史）
const EMOJI_GROUPS = {
  smile: { label: '笑脸', list: ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','☺️','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓'] },
  emotion: { label: '情感', list: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💌','😢','😭','😤','😠','😡','🤬','🥺','😱','😨','😰'] },
  gesture: { label: '手势', list: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','👋','🤚','🖐️','✋','🖖','👏','🙌','🤝','🙏','💪','🦾','🤳','💅','👀','👁️','👅','👂'] },
  // mine：用户本小程序发送过的表情（运行时由 storage 填充）
  mine: { label: '常用', list: [] }
};

Page({
  data: {
    convId: '', peer: '', goodsId: '',
    goods: null, peerInfo: {},
    messages: [], draft: '', scrollTo: '',
    title: '聊天',
    defaultCover: '/images/goods-cover-default.png',
    defaultAvatar: '/images/avatar-default.png',
    // 图片加载失败标记（存储临时链接过期 / 服务不可用时会失败）→ 回退占位图/提示，避免留白
    peerAvatarErr: false,
    goodsCoverErr: false,
    imgErr: {}, // { [消息_id]: true }
    showEmoji: false, showPlus: false,
    emojiCats: ['smile', 'emotion', 'gesture', 'mine'].map(k => ({ key: k, label: EMOJI_GROUPS[k].label })),
    emojiCat: 'smile',
    currentEmojis: EMOJI_GROUPS.smile.list
  },

  onLoad(opt) {
    this.setData({ convId: opt.convId || '', peer: opt.peer || '', goodsId: opt.goodsId || '' });
    this._emojiGroups = EMOJI_GROUPS;
    this._loadMyEmojis();
  },

  async onShow() {
    // ⚠️ 可见性守卫：onShow 里 await initUser() 期间用户可能已切走（onHide 先执行）。
    // 原实现会在 await 恢复后**照常创建轮询定时器** —— 此时 onHide 已经跑过，
    // 这个定时器没人清理，页面在后台仍持续请求（流量/耗电）。
    this._visible = true;
    await app.initUser();
    if (!this._visible) return;
    if (this.data.goodsId) this.loadGoods();
    // 已有消息 → 增量续拉（只取新消息）；首次 → 全量拉取
    if (this.data.convId) this.loadMessages({ incremental: this.data.messages.length > 0 });
    if (this.data.peer) this.loadPeer();
    // 轮询改为「增量」：每 4s 只拉 since 之后的新消息，无新消息则不 setData（几乎零开销）
    if (!this.timer) this.timer = setInterval(() => this.loadMessages({ incremental: true }), 4000);
    this._loadMyEmojis(); // 每次进入聊天都刷新「常用」
    this._measureInputBar(); // 量输入栏高度，供 emoji/plus 面板对齐
  },

  onHide() {
    // 页面隐藏（切到其他页/进后台）→ 暂停轮询，避免后台空转的请求与流量
    this._visible = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // 进入聊天已把本会话标为已读 → 回来时刷新 tabBar 未读角标
    try { getApp().refreshUnreadBadge(); } catch (e) {}
  },

  onUnload() {
    clearInterval(this.timer);
    this.timer = null;
    try { getApp().refreshUnreadBadge(); } catch (e) {}
  },

  /**
   * 实测输入栏高度并写进 --input-h（emoji / plus 面板的 bottom 靠它对齐）。
   *
   * 为什么不能用固定值：.ipt 是 auto-height 的 textarea（40~240rpx），
   * 用户换行后 .input-bar 会明显变高。此前面板 bottom 写死 100rpx，
   * 单行时悬空 4rpx 露缝、多行时面板直接被输入框盖住。
   * 这里量完真实高度后写内联 CSS 变量，两种情况都对齐。
   */
  _measureInputBar() {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .select('.input-bar')
        .boundingClientRect(rect => {
          if (!rect || !rect.height) return;
          // px → rpx（rpx = px * 750 / 屏宽）
          let rpx = rect.height;
          try {
            const win = wx.getWindowInfo();
            const w = win.windowWidth || 375;
            rpx = Math.ceil(rect.height * 750 / w);
          } catch (e) { rpx = Math.ceil(rect.height * 2); } // 兜底按 375 屏宽估
          if (rpx === this._inputH) return; // 高度没变 → 不重复 setData
          this._inputH = rpx;
          this.setData({ inputH: rpx });
        })
        .exec();
    });
  },

  /** 输入框聚焦：关掉 emoji / plus 面板，避免遮挡 */
  onInputFocus() {
    if (this.data.showEmoji || this.data.showPlus) this.setData({ showEmoji: false, showPlus: false });
  },
  onInputBlur() {},

  /** 切到 "+" 弹出的功能面板（相册 / 拍摄） */
  togglePlus() {
    this.setData({ showPlus: !this.data.showPlus, showEmoji: false });
  },
  onPickFromAlbum() { this.setData({ showPlus: false }); this.pickImage('album'); },
  onPickFromCamera() { this.setData({ showPlus: false }); this.pickImage('camera'); },

  /** 从 storage 读取用户最近在本小程序发送过的表情（去重 + 上限 30） */
  _loadMyEmojis() {
    try {
      const mine = wx.getStorageSync('cm_my_emojis') || [];
      this._emojiGroups.mine.list = mine;
      // 仅在当前选中的是「常用」时刷新显示
      if (this.data.emojiCat === 'mine') {
        this.setData({ currentEmojis: mine });
      }
    } catch (e) {}
  },

  /** 把刚发送的表情加入「常用」（去重，最多 30 个） */
  _pushMyEmoji(em) {
    if (!em) return;
    let mine = [];
    try { mine = wx.getStorageSync('cm_my_emojis') || []; } catch (e) {}
    mine = [em, ...mine.filter(x => x !== em)].slice(0, 30);
    try { wx.setStorageSync('cm_my_emojis', mine); } catch (e) {}
  },

  async loadPeer() {
    if (this._peerLoaded) return;
    try {
      const p = await call('user', { action: 'getPublic', openid: this.data.peer }, { silent: true, loading: false });
      this._peerLoaded = true;
      this.setData({ peerInfo: p });
      const title = (p.nickName || '同学') + (p.verified ? ' ✓已认证' : '');
      // 双保险：nav-bar 组件 prop + 微信原生标题
      this.setData({ title });
      wx.setNavigationBarTitle({ title });
    } catch (e) {}
  },

  async loadGoods() {
    if (!this.data.goodsId) return;
    try {
      const g = await call('goods', { action: 'detail', id: this.data.goodsId }, { silent: true, loading: false });
      let cover = g.cover || (Array.isArray(g.images) && g.images[0]) || '';
      // 清理无效封面：wxfile:// 是本机临时路径（对方设备上必失效）→ 清空；
      // ⚠️ http(s):// 是有效网络图（本地模式 /files/** 或任意图床），必须保留 ——
      // 之前把 http:// 也一并清空，导致本地模式下商品小卡永远不渲染。
      if (!cover) cover = '';
      else if (cover.startsWith('wxfile://')) cover = '';
      else if (cover.startsWith('cloud://')) {
        try {
          const tr = await wx.cloud.getTempFileURL({ fileList: [cover] });
          const u = tr.fileList && tr.fileList[0] && tr.fileList[0].tempFileURL;
          cover = u || '';
        } catch (e) { cover = ''; }
      }
      this.setData({ goods: { cover, title: g.title, price: g.price } });
    } catch (e) {}
  },

  /** 统一消息视图（补 mine/timeText/isImage/pending 等渲染字段） */
  _mapMsg(m, openid) {
    return {
      ...m,
      mine: m._openid === openid,
      timeText: formatTime(m.createdAt),
      isImage: m.type === 'image',
      pending: !!m.pending,
      failed: !!m.failed
    };
  },

  /**
   * 拉取消息。
   * @param {{incremental?:boolean}} opts incremental=true 时只拉 _lastTs 之后的新消息，
   *   无新消息则不 setData（省掉每 4s 的无谓渲染）。
   */
  async loadMessages(opts = {}) {
    if (!this.data.convId) return;
    if (this._loadingMsgs) return;           // 防重入（轮询与手动刷新并发）
    if (opts.incremental && this._sending) return; // 有未确认发送 → 跳过，避免与乐观替换竞争产生重复
    const incremental = opts.incremental === true && this._lastTs > 0;
    this._loadingMsgs = true;
    try {
      const r = await call('chat', {
        action: 'messages',
        convId: this.data.convId,
        since: incremental ? this._lastTs : 0
      }, { silent: true, loading: false });
      const openid = app.globalData.openid;
      const incoming = (r.list || []).map(m => this._mapMsg(m, openid));
      let messages;
      if (incremental && !r.truncated) {
        if (!incoming.length) return; // 无新消息 → 不 setData，零渲染开销
        const known = new Set(this.data.messages.map(m => m._id));
        const add = incoming.filter(m => !known.has(m._id));
        if (!add.length) return;
        messages = this.data.messages.concat(add);
      } else {
        messages = incoming;
      }
      this._lastTs = messages.reduce((mx, m) => Math.max(mx, m.createdAt || 0), this._lastTs || 0);
      this.setData({ messages, scrollTo: messages.length ? 'm-' + messages[messages.length - 1]._id : '' });
    } catch (e) {
    } finally {
      this._loadingMsgs = false;
    }
  },

  onInput(e) {
    this.setData({ draft: e.detail.value });
    // 输入时关掉 plus 面板（避免和键盘一起占空间）
    if (this.data.showPlus) this.setData({ showPlus: false });
    // 内容换行会撑高 auto-height 的 textarea → 输入栏高度变了，重测一次
    this._measureInputBar();
  },

  toggleEmoji() {
    this.setData({ showEmoji: !this.data.showEmoji, showPlus: false });
  },

  switchEmojiCat(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ emojiCat: k, currentEmojis: this._emojiGroups[k].list });
  },

  pickEmoji(e) {
    const em = e.currentTarget.dataset.em;
    this.setData({ draft: (this.data.draft || '') + em });
  },

  /** 选图发送：source = 'album' | 'camera' | 'both'（默认） */
  pickImage(source = 'both') {
    const opts = { count: 1, mediaType: ['image'], sizeType: ['compressed'] };
    if (source === 'album') opts.sourceType = ['album'];
    else if (source === 'camera') opts.sourceType = ['camera'];
    else opts.sourceType = ['album', 'camera'];
    wx.chooseMedia({
      ...opts,
      success: async r => {
        const temp = r.tempFiles && r.tempFiles[0];
        if (!temp) return;
        const localPath = temp.tempFilePath;
        // ① 立刻用本地临时图乐观上屏（不等压缩/上传，点了就能看见）
        const now = Date.now();
        const tmpId = 'tmp-' + now + '-' + Math.random().toString(36).slice(2, 6);
        const myOpenid = app.globalData.openid;
        this.setData({
          messages: this.data.messages.concat([{
            _id: tmpId, _openid: myOpenid, convId: this.data.convId, type: 'image',
            content: localPath, createdAt: now, pending: true,
            mine: true, timeText: formatTime(now), isImage: true
          }]),
          scrollTo: 'm-' + tmpId, showPlus: false
        });
        try {
          wx.showLoading({ title: '发送中…', mask: true });
          // ② 客户端压缩（长边 1080px）—— 聊天图不需原画质，压完体积小、上传快
          const compressed = await this._compressImage(localPath);
          const ext = (compressed.match(/\.(\w+)$/) || [, 'jpg'])[1];
          const cloudPath = `chat/${myOpenid || 'wxu'}_${Date.now()}.${ext}`;
          // 统一适配器上传（本地后端/云存储自动切换），直接返回可用的图片地址
          const { upFile } = require('../../utils/cloud.js');
          const fileUrl = await upFile({ cloudPath, filePath: compressed });
          // ③ 上传完再发给服务端，并把气泡换成 https 链接
          await this._sendImage(tmpId, fileUrl);
        } catch (e) {
          console.error('pickImage send fail', e);
          this.setData({
            messages: this.data.messages.map(m => m._id === tmpId ? { ...m, pending: false, failed: true } : m)
          });
          wx.showToast({ title: '图片发送失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
      fail: err => {
        if (err && err.errMsg && err.errMsg.indexOf('auth') !== -1) {
          wx.showToast({ title: '请允许相机/相册权限', icon: 'none' });
        } else if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          console.error('chooseMedia fail', err);
        }
      }
    });
  },

  /** 压缩单张图：长边 1080px / 质量 80；失败回退原图 */
  _compressImage(src) {
    return new Promise(resolve => {
      if (!wx.compressImage) return resolve(src);
      wx.compressImage({
        src, quality: 80, compressedWidth: 1080,
        success: r => resolve((r && r.tempFilePath) || src),
        fail: () => resolve(src)
      });
    });
  },

  /** cloud:// fileID → https 临时链接（用于 <image> 渲染与 previewImage） */
  _toDisplayUrl(fileId) {
    return new Promise(resolve => {
      if (!fileId || fileId.indexOf('cloud://') !== 0) return resolve(fileId);
      wx.cloud.getTempFileURL({ fileList: [fileId] })
        .then(r => resolve((r.fileList && r.fileList[0] && r.fileList[0].tempFileURL) || fileId))
        .catch(() => resolve(fileId));
    });
  },

  /**
   * 内部发送（文本/表情）：乐观上屏 —— 点击后立刻显示消息（pending 态），
   * 再后台发送；成功后用服务端返回的真实 _id 原地替换，不再拉一次全量列表。
   * 这是"发送慢"的关键优化：从"等 2 次网络往返才看到消息"变成"点击即见"。
   */
  async _send({ type, content }) {
    if (!content) return;
    if (!app.globalData.openid) await app.initUser();
    const myOpenid = app.globalData.openid;
    if (!myOpenid) return wx.showToast({ title: '登录信息获取失败', icon: 'none' });

    const now = Date.now();
    const tmpId = 'tmp-' + now + '-' + Math.random().toString(36).slice(2, 6);
    const optimistic = {
      _id: tmpId, _openid: myOpenid, convId: this.data.convId, type, content,
      createdAt: now, pending: true,
      mine: true, timeText: formatTime(now), isImage: type === 'image'
    };
    // 立即上屏 + 清空草稿
    this.setData({ messages: this.data.messages.concat([optimistic]), scrollTo: 'm-' + tmpId, draft: '' });
    // 表情入「常用」
    if (type === 'text') {
      const ems = content.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
      if (ems && ems.length === 1) this._pushMyEmoji(ems[0]);
    }

    this._sending = (this._sending || 0) + 1;
    try {
      const r = await call('chat', {
        action: 'send',
        convId: this.data.convId,
        peerOpenid: this.data.peer,
        goodsId: this.data.goodsId,
        type, content
      }, { silent: true, loading: false });
      const sentAt = (r && r.sentAt) || now;
      this._lastTs = Math.max(this._lastTs || 0, sentAt);
      this.setData({
        messages: this.data.messages.map(m => m._id === tmpId
          ? { ...m, _id: (r && r._id) || tmpId, createdAt: sentAt, timeText: formatTime(sentAt), pending: false }
          : m)
      });
    } catch (e) {
      this.setData({
        messages: this.data.messages.map(m => m._id === tmpId ? { ...m, pending: false, failed: true } : m)
      });
      wx.showToast({ title: (e && e.msg) || '发送失败', icon: 'none' });
    } finally {
      this._sending = Math.max(0, (this._sending || 1) - 1);
    }
  },

  /** 图片消息：已乐观上屏（tmpId + 本地临时图），上传完成后用真实 fileID 发送并换成 https 链接 */
  async _sendImage(tmpId, fileId) {
    this._sending = (this._sending || 0) + 1;
    try {
      const r = await call('chat', {
        action: 'send', convId: this.data.convId,
        peerOpenid: this.data.peer, goodsId: this.data.goodsId,
        type: 'image', content: fileId
      }, { silent: true, loading: false });
      const url = await this._toDisplayUrl(fileId);
      const sentAt = (r && r.sentAt) || Date.now();
      this._lastTs = Math.max(this._lastTs || 0, sentAt);
      this.setData({
        messages: this.data.messages.map(m => m._id === tmpId
          ? { ...m, _id: (r && r._id) || tmpId, content: url, createdAt: sentAt, timeText: formatTime(sentAt), pending: false }
          : m)
      });
    } catch (e) {
      this.setData({
        messages: this.data.messages.map(m => m._id === tmpId ? { ...m, pending: false, failed: true } : m)
      });
      wx.showToast({ title: (e && e.msg) || '图片发送失败', icon: 'none' });
    } finally {
      this._sending = Math.max(0, (this._sending || 1) - 1);
    }
  },

  async send() {
    const content = (this.data.draft || '').trim();
    if (!content) return;
    await this._send({ type: 'text', content });
  },

  previewMsgImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = (this.data.messages || []).filter(m => m.isImage).map(m => m.content);
    if (!url || !urls.length) return;
    wx.previewImage({ urls, current: url });
  },

  /** 对端头像加载失败 → 回退默认头像 */
  onPeerAvatarErr() {
    if (this.data.peerAvatarErr) return;
    this.setData({ peerAvatarErr: true });
  },

  /** 顶部商品封面加载失败 → 回退占位图 */
  onGoodsCoverErr() {
    if (this.data.goodsCoverErr) return;
    this.setData({ goodsCoverErr: true });
  },

  /** 图片消息加载失败 → 该条显示「图片加载失败」，避免空白气泡 */
  onMsgImgErr(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : '';
    if (!id || this.data.imgErr[id]) return;
    console.warn('[chatroom] 图片消息加载失败：', id);
    this.setData({ ['imgErr.' + id]: true });
  },

  goGoods() {
    if (this.data.goodsId) wx.navigateTo({ url: `/pages/detail/detail?id=${this.data.goodsId}` });
  },

  /** 内部助手：调 chat 云函数 deleteMessage。仅供管理/自动化清理使用（脏数据、测试残留） */
  _adminDeleteMessage(msgId) {
    return call('chat', { action: 'deleteMessage', msgId }, { silent: true, loading: false });
  }
});