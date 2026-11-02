const app = getApp();
const { call } = require('../../utils/cloud.js');
const { condText, cleanReason } = require('../../utils/util.js');
const { catName } = require('../../utils/categories.js');

/** 清洗原因文案统一走 utils/util.js 的 cleanReason
 *  （原先 detail / sold / admin-goods 三页各抄一份，规则易漂移）。 */

/**
 * 卖家视角提示：告诉卖家「这件商品现在为什么不显示在首页」。
 * 与后台「商品管理」的信息保持一致 —— 卖家知道原因才不会再盲目重发。
 * @returns {Object|null} 无异常时返回 null（不渲染提示区）
 */
function buildOwnerNotice(item) {
  if (!item) return null;
  const st = item.status || 'onSale';
  if (st === 'onSale') return null;

  if (st === 'pending') {
    return {
      icon: '⏳', title: '审核中，暂未上架',
      desc: '审核通过后会自动出现在首页，无需重复发布。'
    };
  }
  if (st === 'sold') {
    return { icon: '✅', title: '已售出，不再展示在首页', desc: '' };
  }
  if (st === 'reserved') {
    return { icon: '🤝', title: '已被预订，暂不展示在首页', desc: '' };
  }
  if (st === 'banned') {
    return {
      icon: '🚫', title: '已被禁售，不再展示在首页',
      reasonLabel: '禁售原因',
      reason: cleanReason(item.banReason || item.offReason),
      desc: '如需申诉，可通过「我的-意见反馈」联系管理员。'
    };
  }
  // off：区分自主下架 / 审核驳回 / 举报下架 / 管理员下架 / 图片违规
  const TYPE = {
    reviewReject: '审核未通过',
    report: '因举报被下架',
    admin: '被管理员下架',
    imgRisk: '图片内容违规被下架',
    self: '你已自主下架'
  };
  const title = TYPE[item.offType] || '已下架，不再展示在首页';
  const reason = cleanReason(item.offReason);
  return {
    icon: item.offType === 'imgRisk' ? '🖼️' : (item.offType === 'reviewReject' ? '📝' : '📥'),
    title,
    reasonLabel: '下架原因',
    reason: reason && item.offType !== 'self' ? reason : '',
    desc: item.offType === 'self' ? '如需重新上架，点击下方「重新上架」。' : ''
  };
}

Page({
  data: {
    id: '',
    item: null,
    loadError: '',   // 加载失败（非「不存在」）时展示错误 + 重试
    condText: '',
    ownerNotice: null,
    isOwner: false,
    swiperCurrent: 0,
    defaultAvatar: '/images/avatar-default.png',
    defaultCover: '/images/goods-cover-default.png',
    imgErr: {},      // { [图片索引]: true } —— 该张大图加载失败，回退占位图
    avatarErr: false // 卖家头像加载失败
  },

  onLoad(opt) {
    if (!opt.id) return wx.navigateBack();
    this.setData({ id: opt.id });
  },

  onShow() { this.fetch(); },

  /** 大图加载失败（存储链接过期 / 服务不可用）→ 该张回退占位图，避免整块留白 */
  onHeroErr(e) {
    const idx = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.idx : undefined;
    if (idx === undefined || idx === null) return;
    if (this.data.imgErr[idx]) return;
    console.warn('[detail] 大图加载失败，回退占位图 idx=' + idx);
    this.setData({ ['imgErr.' + idx]: true });
  },

  /** 卖家头像加载失败 → 回退默认头像 */
  onAvatarErr() {
    if (this.data.avatarErr) return;
    this.setData({ avatarErr: true });
  },

  async fetch() {
    try {
      // 等登录就绪，否则「是否自己的商品」会误判（openid 为空时自己的商品也当成别人的）
      await app.initUser();
      const item = await call('goods', { action: 'detail', id: this.data.id }, { silent: true, loading: false });
      const isOwner = item._openid === app.globalData.openid;
      // 求购无成色概念 → condText 留空，避免显示「正常使用」
      const ct = item.type === 'want' ? '' : condText(item.condition);
      const ownerNotice = isOwner ? buildOwnerNotice(item) : null;
      // 分类中文名：库里存的是 key（book/digital…），此前 wxml 直接渲染 → 用户看到英文。
      // 优先用服务端下发的 categoryText（老版本云函数没有该字段时，本地映射兜底）。
      const categoryText = item.categoryText || catName(item.category);
      // 价格范围展示：有原价 → 「199 - 320」（¥199 - ¥320），无原价沿用单价
      const priceRange = item.originalPrice ? (item.price + ' - ' + item.originalPrice) : String(item.price);
      this.setData({ item, isOwner, condText: ct, categoryText, priceRange, ownerNotice, imgErr: {}, avatarErr: false, loadError: '' });
    } catch (e) {
      // ⚠️ 必须区分「商品真的不存在」（服务端 404）与「请求失败」。
      // 原实现一律 `setData({item:null})`，会被 WXML 渲染成「商品不存在或已下架」——
      // 网络抖动/云函数超时都会让用户以为商品被删了，且没有重试入口。
      const code = e && e.code;
      if (code === 404) {
        this.setData({ item: null, loadError: '' });
      } else {
        console.error('商品详情加载失败', e);
        this.setData({ loadError: (e && e.msg) || '加载失败，请重试' });
      }
    }
  },

  /** 加载失败后点「重试」 */
  retry() {
    this.setData({ loadError: '' });
    this.fetch();
  },

  onSwiperChange(e) { this.setData({ swiperCurrent: e.detail.current }); },

  previewImage(e) {
    wx.previewImage({ urls: this.data.item.images, current: e.currentTarget.dataset.url });
  },

  async toggleFav() {
    await app.initUser();
    if (!app.globalData.openid) return app.requireLogin();
    // 防连点：连点两次会「收藏 → 立刻又取消」，用户以为没生效
    if (this._favBusy) return;
    this._favBusy = true;
    try {
      const r = await call('user', { action: 'toggleFav', goodsId: this.data.id }, { silent: true });
      const item = { ...this.data.item, faved: r.faved, favCount: (item => item + (r.faved ? 1 : -1))(this.data.item.favCount || 0) };
      this.setData({ item, actionError: '' });
      wx.showToast({ title: r.faved ? '已收藏' : '已取消', icon: 'none' });
    } catch (e) {
      // 不再静默：把原因写进 data，便于真机自动化脚本读到具体错误
      console.error('toggleFav 失败', e);
      this.setData({ actionError: '收藏失败：' + ((e && e.msg) || '未知错误') });
      wx.showToast({ title: (e && e.msg) || '操作失败', icon: 'none' });
    } finally { this._favBusy = false; }
  },

  async toggleWant() {
    await app.initUser();
    if (!app.globalData.openid) return app.requireLogin();
    // 防连点：同上，避免「想要 → 立刻又取消」
    if (this._wantBusy) return;
    this._wantBusy = true;
    try {
      const r = await call('user', { action: 'toggleWant', goodsId: this.data.id }, { silent: true });
      const item = { ...this.data.item, wanted: r.wanted, wantCount: (item => item + (r.wanted ? 1 : -1))(this.data.item.wantCount || 0) };
      this.setData({ item, actionError: '' });
      wx.showToast({ title: r.wanted ? '已想要' : '已取消', icon: 'none' });
    } catch (e) {
      console.error('toggleWant 失败', e);
      this.setData({ actionError: '想要失败：' + ((e && e.msg) || '未知错误') });
      wx.showToast({ title: (e && e.msg) || '操作失败', icon: 'none' });
    } finally { this._wantBusy = false; }
  },

  goChat() {
    wx.navigateTo({ url: `/pages/chatroom/chatroom?peer=${this.data.item._openid}&goodsId=${this.data.item._id}` });
  },

  goReport() {
    wx.navigateTo({ url: `/pages/report/report?targetType=goods&targetId=${this.data.id}` });
  },

  async goBuy() {
    await app.initUser();
    if (!app.globalData.openid) return app.requireLogin();
    if (!app.isVerified()) {
      wx.showModal({
        title: '需要学生认证', content: '完成认证后才能预约自提',
        confirmText: '去认证', success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/verify/verify' }); }
      });
      return;
    }
    wx.navigateTo({ url: `/pages/order/order?action=create&goodsId=${this.data.id}` });
  },

  goSeller(e) {
    const id = e.currentTarget.dataset.id || this.data.item._openid;
    if (!id) return;
    wx.navigateTo({ url: `/pages/sold/sold?openid=${id}` });
  },

  onEdit() {
    // 发布页是 tabBar 页，navigateTo 跳不过去；用一次性缓存传 id + reLaunch
    wx.setStorageSync('cm_edit_goods_id', this.data.item._id);
    wx.reLaunch({ url: '/pages/publish/publish' });
  },

  async onOff() {
    const item = this.data.item;
    const next = item.status === 'off' ? 'onSale' : 'off';
    if (this._offBusy) return; // 防连点：避免「下架 → 立刻又上架」
    this._offBusy = true;
    try {
      await call('goods', { action: 'setStatus', id: item._id, status: next });
      wx.setStorageSync('cm_home_dirty', Date.now()); // 卖家上下架后首页强制刷新
      this.fetch();
      wx.showToast({ title: next === 'off' ? '已下架' : '已重新上架' });
    } catch (e) {} finally { this._offBusy = false; }
  },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); },

  choosePickup() {
    wx.navigateTo({ url: '/pages/pickup/pickup' });
  },

  /** 微信原生分享给好友（小程序右上角 ... 会出现「转发」按钮） */
  onShareAppMessage() {
    const it = this.data.item;
    if (!it) return {};
    return {
      title: it.title ? `¥${it.price} · ${it.title}` : '校园集市好物推荐',
      path: `/pages/detail/detail?id=${it._id}`,
      imageUrl: it.cover || ''
    };
  },

  /** 分享到朋友圈（需要先在管理后台开启"分享到朋友圈"能力） */
  onShareTimeline() {
    const it = this.data.item;
    if (!it) return {};
    return {
      title: it.title ? `${it.title} · ¥${it.price}` : '校园集市',
      query: `id=${it._id}`
    };
  }
});
