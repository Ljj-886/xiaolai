// utils/constants.js
// 通用常量。
//
// 分类体系已抽到 utils/categories.js 作为唯一数据源（此前 key/中文名/图标
// 三份映射散落在 7 个文件里，漏改处会把英文 key 直接显示给用户）。
// 这里继续导出 CATEGORIES 以兼容既有 import；**新增代码请直接 require utils/categories.js**，
// 需要中文名一律用 catName(key)，不要各页面再写 CATEGORIES.find(...)。
const { CATEGORIES, catName, catIcon, catEmoji, catOf, catOptions, isCatKey } = require('./categories.js');

module.exports = {
  CATEGORIES,
  catName,
  catIcon,
  catEmoji,
  catOf,
  catOptions,
  isCatKey,
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
