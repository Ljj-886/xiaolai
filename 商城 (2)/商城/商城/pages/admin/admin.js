const { call } = require('../../utils/cloud.js');
const { formatTime } = require('../../utils/util.js');

/** 审计日志里的 action 标识 → 中文说明（查不到的原样展示） */
const ACTION_TEXT = {
  'viewSensitive:getUserDetail': '查看用户敏感资料',
  reviewGoods: '商品审核',
  handleReport: '处理举报',
  adminOff: '下架商品',
  banGoods: '禁售商品',
  recheckGoods: '二次审核商品',
  clearUser: '清查用户',
  forceUnverify: '取消认证',
  adminBan: '封禁用户',
  adminUnban: '解封用户',
  setAdmin: '设置管理员',
  wipeGoods: '清空商品'
};

// 时间格式统一走 utils/util.js 的 formatTime（此前 admin / admin-goods / admin-reviews
// 各写了一份完全相同的 fmtTime，属重复实现；这里统一收敛，只保留一个来源）。
const fmtTime = formatTime;

Page({
  data: {
    stats: {},
    todos: [],
    totalTodo: 0,   // 待办总数：一眼知道"还有多少活"
    loading: false,
    logsOpen: false,
    logsLoading: false,
    logs: []
  },

  onShow() {
    this.fetchAll();
  },

  async fetchAll() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const common = { silent: true, loading: false };
      const [stats, fb] = await Promise.all([
        call('admin', { action: 'stats' }, common),
        call('feedback', { action: 'list', status: 'pending', pageSize: 1 }, common).catch(() => ({ total: 0 }))
      ]);
      const pendingFeedback = (fb && fb.total) || 0;
      const todos = [
        { key: 'verify', label: '待审核认证', hint: '学生身份认证申请', count: stats.pendingVerify || 0, page: 'admin-reviews', tab: 'verify' },
        { key: 'goods', label: '待审核商品', hint: '新发布商品等待上架确认', count: stats.pendingGoods || 0, page: 'admin-goods', tab: 'pending' },
        { key: 'recheck', label: '待二次审核商品', hint: '已被下架/禁售，需复核去向', count: stats.recheckGoods || 0, page: 'admin-goods', tab: 'recheck' },
        { key: 'report', label: '待处理举报', hint: '用户举报等待核实', count: stats.pendingReports || 0, page: 'admin-reviews', tab: 'report' },
        { key: 'feedback', label: '用户反馈待处理', hint: '使用问题与建议', count: pendingFeedback, page: 'admin-reviews', tab: 'feedback' }
      ];
      // 待办按数量倒序：有活先干，数量多的优先（一眼看到最该处理的）
      todos.sort((a, b) => (b.count || 0) - (a.count || 0));
      const totalTodo = todos.reduce((s, t) => s + (t.count || 0), 0);
      this.setData({ stats, todos, totalTodo });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goPage(e) {
    const { page, tab } = e.currentTarget.dataset;
    let url = `/pages/${page}/${page}`;
    if (tab) url += `?tab=${encodeURIComponent(tab)}`;
    wx.navigateTo({ url });
  },

  /**
   * 展开/收起「操作日志」。
   * 审计数据一直在写（谁在何时看了谁的敏感资料、做了什么管理动作），
   * 但此前后台没有任何入口能看 —— 接口修好后补上这里。
   */
  async toggleLogs() {
    if (this.data.logsOpen) { this.setData({ logsOpen: false }); return; }
    this.setData({ logsOpen: true, logsLoading: true });
    try {
      // 集合从未写入时为空，云函数已做兜底返回空列表，这里不会 500
      const r = await call('admin', { action: 'adminLogs', page: 1, pageSize: 20 }, { silent: true, loading: false });
      const list = (r.list || []).map((x, i) => ({
        // 保留稳定 key：原先 wx:key="index" 在日志增删后会错误复用节点
        _id: x._id || `log_${x.createdAt || 0}_${i}`,
        timeText: fmtTime(x.createdAt),
        actionText: ACTION_TEXT[x.action] || x.action || '未知操作',
        targetText: String(x.targetOpenid || x.targetId || '').slice(-8)
      }));
      this.setData({ logs: list });
    } catch (e) {
      this.setData({ logs: [] });
    } finally {
      this.setData({ logsLoading: false });
    }
  },

  async initData() {
    try {
      const r = await call('admin', { action: 'init' });
      wx.showToast({ title: r.promoted ? '已初始化，您已是管理员' : '已初始化', icon: 'success' });
      this.fetchAll();
    } catch (e) { wx.showToast({ title: e.message || '初始化失败', icon: 'none' }); }
  }
});
