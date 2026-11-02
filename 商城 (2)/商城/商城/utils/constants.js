// utils/constants.js
module.exports = {
  CATEGORIES: [
    { key: 'book', name: '教材书籍', icon: '📚' },
    { key: 'digital', name: '数码电子', icon: '💻' },
    { key: 'dorm', name: '宿舍神器', icon: '🛏️' },
    { key: 'clothes', name: '服饰鞋包', icon: '👕' },
    { key: 'sports', name: '运动户外', icon: '🏀' },
    { key: 'beauty', name: '美妆护肤', icon: '💄' },
    { key: 'bike', name: '代步出行', icon: '🚲' },
    { key: 'ticket', name: '票券卡券', icon: '🎫' },
    { key: 'life', name: '生活日用', icon: '🧴' },
    { key: 'other', name: '其他闲置', icon: '📦' }
  ],
  CONDITIONS: [
    { value: 'new', label: '全新' },
    { value: 'likeNew', label: '几乎全新' },
    { value: 'slight', label: '轻微使用' },
    { value: 'normal', label: '正常使用' },
    { value: 'worn', label: '明显使用' }
  ],
  REPORT_REASONS: [
    '虚假信息', '违禁品', '色情低俗', '人身攻击', '价格欺诈', '已售未删', '其他'
  ]
};
