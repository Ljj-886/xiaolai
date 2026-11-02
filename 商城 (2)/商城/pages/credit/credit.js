const { call } = require('../../utils/cloud.js');
const { fromNow } = require('../../utils/util.js');

Page({
  data: {
    credit: 100,
    level: '',
    levelDesc: '',
    soldCount: 0,
    boughtCount: 0,
    reviewCount: 0,
    avgScore: null,
    reviews: [],
    loaded: false,
    error: '',
    rules: [
      { icon: '🌱', title: '初始分 100', desc: '完成校园认证后获得基础信用分' },
      { icon: '⭐', title: '好评 +2', desc: '自提完成后获得 4~5 星评价' },
      { icon: '➖', title: '中评 ±0', desc: '获得 3 星评价，信用分不变' },
      { icon: '⚠️', title: '差评 -3', desc: '获得 1~2 星评价，扣减信用分' },
      { icon: '🚫', title: '违规下架', desc: '发布违禁品被举报核实后扣 10 分/次' }
    ]
  },

  onShow() { this.fetch(); },
  onPullDownRefresh() { this.fetch().then(() => wx.stopPullDownRefresh()); },

  async fetch() {
    try {
      const r = await call('user', { action: 'myCredit' }, { silent: true, loading: false }) || {};
      // 注意：此前这里误用了未声明的 credit，直接抛 ReferenceError 导致整页白屏
      const credit = r.credit != null ? Number(r.credit) : 100;
      let level = '良好';
      let levelDesc = '继续保持诚信约定哦';
      // 信用分上限 100：99~100 = 极好；80~98 = 良好；60~79 = 一般；<60 = 较差
      if (credit >= 95) { level = '极好'; levelDesc = '信用极佳，自提优选对象'; }
      else if (credit >= 80) { level = '良好'; levelDesc = '信用良好，值得信赖'; }
      else if (credit >= 60) { level = '一般'; levelDesc = '近期约定有待改进'; }
      else { level = '较差'; levelDesc = '多次差评或违规，请谨慎自提'; }
      // WXML 无法调用 JS 函数（setData 会丢弃函数），时间在 JS 层格式化好再渲染
      const reviews = (r.reviews || []).map(x => ({ ...x, createdAtText: fromNow(x.createdAt) }));
      this.setData({
        credit, level, levelDesc,
        soldCount: r.soldCount || 0,
        boughtCount: r.boughtCount || 0,
        reviewCount: r.reviewCount || 0,
        avgScore: r.avgScore,
        reviews,
        loaded: true,
        error: ''
      });
    } catch (e) {
      this.setData({ loaded: true, error: (e && e.message) || '信用数据加载失败' });
    }
  }
});
