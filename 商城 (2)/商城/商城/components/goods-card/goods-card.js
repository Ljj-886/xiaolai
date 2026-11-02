const { goodsStatusText, condText } = require('../../utils/util.js');

// 无封面 / 加载失败时的占位图。
// 用模块常量而不是 this.data，避免依赖组件 data 的初始化时序。
const DEFAULT_COVER = '/images/goods-cover-default.png';

// 加载失败后延迟多久重试一次（毫秒）
const RETRY_DELAY = 5000;

Component({
  properties: {
    item: { type: Object, value: {} },
    layout: { type: String, value: 'grid' }, // grid | col
    // 首页「举报」入口：仅首页传 true；myOpenid 用于隐藏本人商品（不能举报自己的）
    showReport: { type: Boolean, value: false },
    myOpenid: { type: String, value: '' }
  },
  data: {
    statusText: '',
    condText: '',
    imgSrc: '',
    noCover: false,
    defaultCover: DEFAULT_COVER,
    canReport: false,
    showWant: false // 是否展示「想要」热度角标（由 observers 按 item 计算出布尔值）
  },
  observers: {
    'item': function (item) {
      const s = goodsStatusText(item);
      const cover = item.cover || (Array.isArray(item.images) && item.images[0]) || '';
      const next = cover || DEFAULT_COVER;
      // 图片地址变了（列表刷新/换数据）→ 给新图重新计一次重试机会
      if (next !== this._lastSrc) {
        this._lastSrc = next;
        this._retried = false;
      }
      // 「想要」热度展示条件：① 出售商品（求购没有「别人想要」的语义）② 热度 > 0（0 时不展示，避免满屏 0）
      // ⚠️ 放在 JS 里算好布尔值，而不是写在 WXML 表达式里 ——
      // 复杂表达式（!== 混 && 混 >）在 WXML 里可能不按预期求值，实测踩过（热度标签死活不渲染）。
      const showWant = item.type !== 'want' && Number(item.wantCount || 0) > 0;
      const patch = {
        statusText: s ? s.text : '',
        // 求购没有成色概念（服务端强制 condition='normal'）→ 不显示「正常使用」标签
        condText: item.type === 'want' ? '' : condText(item.condition),
        // 无封面标志：无图求购走专属卡面，不显示灰色占位图
        noCover: !cover,
        showWant
      };
      // 只有目标地址与当前显示不同才改 imgSrc：避免列表刷新时把
      // 「失败→已显示占位图」的状态无谓重置，也避免同图重复触发加载
      if (this.data.imgSrc !== next) patch.imgSrc = next;
      this.setData(patch);
    },
    // 是否展示「举报」按钮：仅首页开启 && 非本人商品（本人商品不提供自举报入口）
    'item, showReport, myOpenid': function (item, showReport, myOpenid) {
      const can = !!showReport && !!(item && item._openid) && item._openid !== (myOpenid || '');
      if (this.data.canReport !== can) this.setData({ canReport: can });
    }
  },
  lifetimes: {
    detached() {
      if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.item._id, item: this.data.item });
    },

    /** 首页「举报」入口：点击后由页面跳转举报页（targetType=goods）。
     *  wxml 用 catchtap 阻止冒泡，不会误触发卡片 onTap（进详情）。 */
    onReport() {
      this.triggerEvent('report', { id: this.data.item._id, item: this.data.item });
    },

    /**
     * 图片加载失败兜底。
     * 常见原因：临时链接过期（403）、存储服务不可用（账号欠费时返回 451）、网络抖动。
     * 处理：① 先降级到占位图（绝不留白）；② **延迟重试一次** —— 临时故障可自愈，
     * 用户不必手动刷新页面。只重试一次，避免持续故障时反复发请求。
     */
    onImgErr(e) {
      const cur = this.data.imgSrc;
      if (!cur || cur === DEFAULT_COVER) return; // 占位图本身失败就放弃，避免死循环
      console.warn('[goods-card] 图片加载失败，暂显示占位图：', (e && e.detail && e.detail.errMsg) || '');
      this._realSrc = cur;
      this.setData({ imgSrc: DEFAULT_COVER });

      if (this._retried) return;
      this._retried = true;
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        // 期间若已被重新渲染成真实图，就不再重试
        if (this._realSrc && this.data.imgSrc === DEFAULT_COVER) {
          // 追加时间戳绕过「失败结果缓存」；额外查询参数不影响 URL 签名（与 imageMogr2 同理）
          const sep = this._realSrc.indexOf('?') >= 0 ? '&' : '?';
          this.setData({ imgSrc: this._realSrc + sep + '_rt=' + Date.now() });
        }
      }, RETRY_DELAY);
    }
  }
});
