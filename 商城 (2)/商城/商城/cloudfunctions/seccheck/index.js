// cloudfunctions/seccheck/index.js
// 内容安全检测：微信官方强制要求——凡用户可输入文字/上传图片，都必须过检。
// 设计原则：失败时「优雅降级」——若内容安全接口未开通/无权限，记录告警并放行，
// 保证开发期与未配置环境不阻断主流程；生产环境必须在云开发控制台开通「内容安全」能力。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ok = d => ({ code: 0, data: d });
const fail = (msg, code = 1) => ({ code, msg });

// 批量图片检测的防护上限：商品最多 9 张图，留 3 张余量；
// 每次并发 5 个（image 检测约 2~3s，串行 100 张必超时，全并发又易触发频控）。
const MAX_IMAGES = 12;
const CONCURRENCY = 5;

/**
 * 文本检测
 * @returns {Promise<{checked:boolean, risky:boolean}>}
 */
async function checkText(content) {
  const text = (content || '').toString().trim();
  if (!text) return { checked: false, risky: false };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    const suggest = (res && res.result && res.result.suggest) || res.suggest || '';
    return { checked: true, risky: suggest === 'risky' };
  } catch (e) {
    console.warn('[seccheck] msgSecCheck 未生效（请到云开发控制台开通内容安全能力）:', (e && (e.errMsg || e.message)) || e);
    return { checked: false, risky: false };
  }
}

/**
 * 图片检测
 * @param {string} fileID cloud:// 开头的文件 ID
 * @returns {Promise<{checked:boolean, risky:boolean}>}
 */
async function checkImage(fileID) {
  if (!fileID || typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    return { checked: false, risky: false };
  }
  try {
    const dl = await cloud.downloadFile({ fileID });
    const buf = dl.fileContent || dl.buffer;
    const contentType = dl.contentType || 'image/png';
    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType, value: buf }
    });
    const suggest = (res && res.result && res.result.suggest) || res.suggest || '';
    return { checked: true, risky: suggest === 'risky' };
  } catch (e) {
    console.warn('[seccheck] imgSecCheck 未生效:', (e && (e.errMsg || e.message)) || e);
    return { checked: false, risky: false };
  }
}

const handlers = {
  async text({ content }, openid) { return ok(await checkText(content)); },
  async image({ fileID }, openid) { return ok(await checkImage(fileID)); },
  /**
   * 批量检测图片，遇到违规立即返回（用于商品发布时校验封面等）。
   *
   * 防超时：checkImage 每次要 downloadFile + imgSecCheck，约 2~3s。
   *   - 原先对传入数组**逐个串行 await 且无数量上限** → 传 100 个 fileID 必然
   *     触发 -504003 云函数超时，前端拿到的是「调用失败」而非检测结果。
   *   - 现改为：① 截断到 MAX_IMAGES（商品图最多 9 张，留 3 张余量）；
   *             ② 分批并行检查（每批 5 个）；③ 任一批发现违规立即返回。
   */
  async images({ fileIDs = [] }, openid) {
    const list = (Array.isArray(fileIDs) ? fileIDs : []).slice(0, MAX_IMAGES);
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const chunk = list.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(f => checkImage(f).then(r => ({ f, r }))));
      const bad = results.find(x => x.r.risky);
      if (bad) return ok({ risky: true, file: bad.f });
    }
    return ok({ risky: false });
  }
};

exports.main = async (event = {}) => {
  const WX = cloud.getWXContext();
  const openid = WX.OPENID || WX.openid || '';
  const fn = handlers[event.action];
  if (!fn) return fail('未知 action: ' + event.action);
  try { return await fn(event, openid); }
  catch (e) { console.error(event.action, e); return fail(e.message || '服务器错误', 500); }
};
