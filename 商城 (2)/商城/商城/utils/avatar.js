// utils/avatar.js
// 头像上传工具：把 wx.chooseAvatar 返回的临时 http 路径上传到云存储，返回永久 cloud:// fileID。
// 背景：chooseAvatar 返回的是 http://tmp/... 临时路径，几天后失效，导致头像变灰。
// 凡是传 http(s) 临时路径进来，都先 wx.cloud.uploadFile 上传，再把 cloud:// 写进数据库。

const app = getApp();

/**
 * 把任意头像 URL 规整成 cloud:// 永久 fileID。
 * - 已是 cloud://：原样返回
 * - 其他（wxfile:// 临时、http:// 临时、https:// 外链、本地路径…）：上传到云存储 avatar/ 目录，返回 cloud://
 * - 空：返回空
 *
 * @param {string} url 头像 URL
 * @returns {Promise<string>} 规整后的 URL（cloud:// 或空）
 */
async function ensureCloudAvatar(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('cloud://')) return url;
  // 临时/本地路径（wxfile://tmp/...、http://tmp/...、http(s):// 外链、本地绝对路径）一律先上传
  if (/^(wxfile|https?):\/\//.test(url) || /^[\/]/.test(url)) {
    try {
      const openid = (app && app.globalData && app.globalData.openid) || 'wxu';
      const cloudPath = `avatar/${openid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: url });
      return (up && up.fileID) || '';
    } catch (e) {
      console.error('[avatar] upload fail', e);
      return '';
    }
  }
  return url;
}

module.exports = { ensureCloudAvatar };
