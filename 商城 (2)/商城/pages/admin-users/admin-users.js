const { call } = require('../../utils/cloud.js');
const { fromNow, formatTime } = require('../../utils/util.js');

const TABS = [
  { key: '', name: '全部' },
  { key: 'verified', name: '已认证' },
  { key: 'pending', name: '待认证' },
  { key: 'banned', name: '已封禁' }
];

// 时间格式化统一走 utils：封禁时间需精确到分钟（判断是否解封的依据），
// utils 的 formatTime 正是 `YYYY-MM-DD HH:mm`，与后台其余三页口径一致。
// （原先这里单独留了一份实现，是上一轮「统一 fmtTime」的漏网之鱼）
const fmtTime = formatTime;

/** 认证状态 → 展示标签 */
const VERIFY_TEXT = {
  pending: { text: '认证审核中', cls: 'tag-warn' },
  approved: { text: '已认证', cls: 'tag-success' },
  rejected: { text: '认证被驳回', cls: 'tag-danger' }
};

Page({
  data: {
    tabs: TABS,
    active: '',
    list: [],
    loading: false,
    page: 1,
    hasMore: true
  },

  onShow() { this.reload(); },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.active) return;
    this.setData({ active: tab });
    this.reload();
  },

  reload() {
    this.setData({ page: 1, list: [], hasMore: true });
    this.loadMore();
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    this.setData({ loading: true });
    try {
      const r = await call('admin', {
        action: 'listUsers',
        status: this.data.active,
        page: this.data.page,
        pageSize: 20
      }, { silent: true, loading: false });
      const list = (r.list || []).map(u => {
        const vt = VERIFY_TEXT[u.verifyStatus] || null;
        return {
          ...u,
          createdAtText: fromNow(u.createdAt),
          banned: !!u.banned,
          // 头像兜底：无/失效 → 默认头像（后台裂图会显得"数据坏了"）
          avatar: u.avatarUrl || '/images/avatar-default.png',
          // 认证标签：以 verifyStatus 为准（已认证的用户不再重复显示"审核中"）
          verifyText: u.verified ? '已认证' : (vt ? vt.text : ''),
          verifyCls: u.verified ? 'tag-success' : (vt ? vt.cls : ''),
          bannedAtText: u.bannedAt ? fmtTime(u.bannedAt) : ''
        };
      });
      this.setData({
        list: this.data.page === 1 ? list : this.data.list.concat(list),
        hasMore: !!r.hasMore,
        page: this.data.page + 1
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() { this.loadMore(); },

  /** 头像加载失败 → 换默认头像（必须改地址，否则永久空白） */
  onAvatarErr(e) {
    const oid = e.currentTarget.dataset.openid;
    const idx = this.data.list.findIndex(u => u._openid === oid);
    if (idx === -1) return;
    if (this.data.list[idx].avatar === '/images/avatar-default.png') return;
    this.setData({ [`list[${idx}].avatar`]: '/images/avatar-default.png' });
  },

  /** 查看用户公开主页（与小程序端一致，便于管理员核对用户真实状态） */
  goProfile(e) {
    const { openid } = e.currentTarget.dataset;
    if (openid) wx.navigateTo({ url: `/pages/sold/sold?openid=${openid}` });
  },

  ban(e) {
    const { openid } = e.currentTarget.dataset;
    wx.showModal({
      title: '封禁用户',
      content: '请填写封禁原因（选填）：',
      editable: true,
      placeholderText: '如：多次违规',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'adminBan', openid, reason: (r.content || '').trim() });
          wx.showToast({ title: '已封禁' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  async unban(e) {
    const { openid } = e.currentTarget.dataset;
    wx.showModal({
      title: '解封用户',
      content: '确认解除该用户的封禁吗？',
      success: async r => {
        if (!r.confirm) return;
        try {
          await call('admin', { action: 'adminUnban', openid });
          wx.showToast({ title: '已解封' });
          this.reload();
        } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
      }
    });
  },

  clear(e) {
    const { openid, nick } = e.currentTarget.dataset;
    wx.showModal({
      title: '清退账号',
      content: `确认清退「${nick || '该用户'}」？将删除其商品等关联数据，操作不可恢复！`,
      confirmColor: '#FF3B30',
      success: async r => {
        if (!r.confirm) return;
        wx.showModal({
          title: '二次确认',
          content: '此操作会删除该用户全部数据，确定继续？',
          confirmColor: '#FF3B30',
          success: async r2 => {
            if (!r2.confirm) return;
            try {
              await call('admin', { action: 'clearUser', openid, reason: '管理员清退' });
              wx.showToast({ title: '已清退' });
              this.reload();
            } catch (e2) { wx.showToast({ title: e2.message || '操作失败', icon: 'none' }); }
          }
        });
      }
    });
  }
});
