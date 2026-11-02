// utils/upload.js
// 图片选择 + 上传云存储的统一封装。
//
// 背景：report / feedback（以及 publish）三处各自复制了一遍「chooseImage → 逐张
// wx.cloud.uploadFile → Promise.all」，差异只在云存储目录名。重复代码导致此前修改
// 上传策略（如统一转 JPEG 压缩）时容易漏改某一处。
//
// 用法：
//   const { chooseAndUpload } = require('../../utils/upload.js');
//   const ids = await chooseAndUpload({ dir: 'report', remain: 3 });   // 返回 fileID 数组
//   // 参数：dir 云存储目录；remain 还能再传几张（<=0 时直接返回空）；onProgress 可选

// 统一走 cloud.js 适配器：本地后端返回 http URL，云模式返回 cloud:// fileID
const { upFile } = require('./cloud.js');

/**
 * 选图并上传到云存储，返回 cloud:// fileID 数组（失败时 reject）。
 * 注意：写入数据库要存 **fileID**（临时路径 wxfile:// 服务端读不到，会存成空引用）。
 *
 * @param {Object}  opts
 * @param {string}  opts.dir        云存储目录名，如 'report' / 'feedback' / 'goods'
 * @param {number}  opts.remain     本次最多可选张数（通常 = 上限 - 已有张数）
 * @param {string}  [opts.loading]  loading 文案，传 '' 则不显示
 * @returns {Promise<string[]>}     fileID 列表（取消选择时返回 []）
 */
function chooseAndUpload({ dir = 'misc', remain = 1, loading = '上传中…' } = {}) {
  return new Promise((resolve, reject) => {
    if (remain <= 0) return resolve([]);
    wx.chooseImage({
      count: remain,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const paths = (res && res.tempFilePaths) || [];
        if (!paths.length) return resolve([]);
        const stamp = Date.now();
        const tasks = paths.map((p, idx) => {
          const ext = (p.match(/\.(\w+)$/) || [, 'jpg'])[1];
          const rand = Math.random().toString(36).slice(2, 6);
          const cloudPath = `${dir}/wxu-${stamp}_${idx}_${rand}.${ext}`;
          return upFile({ cloudPath, filePath: p });
        });
        if (loading) wx.showLoading({ title: loading, mask: true });
        Promise.all(tasks)
          .then(ids => { if (loading) wx.hideLoading(); resolve(ids); })
          .catch(err => {
            if (loading) wx.hideLoading();
            wx.showToast({ title: '图片上传失败', icon: 'none' });
            reject(err);
          });
      },
      // 用户取消选择：resolve 空数组，调用方无需额外处理
      fail: () => resolve([])
    });
  });
}

module.exports = { chooseAndUpload };
