// utils/cloud.js
// 统一封装云函数调用与错误处理。
//
// 关键升级：按 errCode 精确判断（云开发标准错误码 -501000/-501003/-502005 等），
// 不再依赖 errMsg 字符串模糊匹配（旧版本漏掉了 "could not be found"、"execution fail"
// 等变体，导致所有未知错误一律降级为"网络异常，请稍后再试"，用户/开发者都摸不着头脑）。
//
// 兜底策略：把 raw 头一段展示给用户，至少比纯"网络异常"更有信息量；
// 同时 console.error 完整打印 errCode/errMsg/stack，便于开发者工具真机排查。
//
// ============================================================
// ★ 本地后端模式（2026-11-01 新增）
// USE_LOCAL = true  → 所有调用改走本地 Spring Boot 后端 mall-server（http://127.0.0.1:9090）
//                     无需开通/部署微信云开发，断网教室也能完整演示。
// USE_LOCAL = false → 恢复原有微信云开发（wx.cloud.callFunction），云函数需已上传部署。
// 后端把每个云函数域实现为同名 POST 接口（/api/goods、/api/order…），
// action 仍放在 body 里，{ code, msg, data } 响应信封与云函数完全一致，前端业务代码零改动。
// ============================================================

const USE_LOCAL = true;
const LOCAL_BASE = 'http://127.0.0.1:9090/api';
// 本地后端主机（去掉 /api），用于把上传返回的相对路径拼成完整图片 URL
const LOCAL_HOST = 'http://127.0.0.1:9090';

/**
 * 字段名兼容补丁（仅本地后端模式使用）：
 * 云开发数据库记录：主键 _id、用户身份 _openid（原作者前端按此写法，
 * 跳详情 / 判断是否本人 / wx:key 都依赖 item._id、item._openid）；
 * 本地 MySQL 实体字段：id / openid。
 * 在响应出口统一补上别名，前端业务代码零改动 ——
 * 不补的话 item._id 是 undefined，`if (id) wx.navigateTo` 直接不执行，
 * 表现就是「点商品卡片没反应、商品详情进不去」。
 */
function patchCloudIds(v, depth) {
  if (v == null || typeof v !== 'object') return v;
  if (depth > 6) return v; // 防御：响应不该有这么深的嵌套
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) patchCloudIds(v[i], depth + 1);
    return v;
  }
  if (!('_id' in v) && 'id' in v) v._id = v.id;
  if (!('_openid' in v) && 'openid' in v) v._openid = v.openid;
  for (const k in v) {
    if (v[k] !== null && typeof v[k] === 'object') patchCloudIds(v[k], depth + 1);
  }
  return v;
}

/**
 * 统一调用入口：本地后端 / 云函数二选一。
 * 返回 Promise，resolve 值为响应信封 { code, msg, data }（与云函数 res.result 同构）。
 */
function callFn(name, data = {}) {
  if (!USE_LOCAL) {
    return wx.cloud.callFunction({ name, data }).then(res => res && res.result);
  }
  // 云函数里 openid 由微信自动注入，本地后端拿不到，
  // 统一从本地缓存带上（login 成功后 app.js 会写 cm_openid）
  const body = { ...data };
  if (!body.openid) {
    const oid = wx.getStorageSync('cm_openid');
    if (oid) body.openid = oid;
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: LOCAL_BASE + '/' + name,
      method: 'POST',
      data: body,
      timeout: 15000,
      success: r => {
        // 后端 R.java 返回 { code, msg, data }，HTTP 状态一律 200
        if (r.statusCode >= 200 && r.statusCode < 300 && r.data && typeof r.data.code === 'number') {
          // 出口统一补 _id/_openid 别名（本地 MySQL 字段是 id/openid，见 patchCloudIds 注释）
          if (r.data.data !== null && typeof r.data.data === 'object') {
            patchCloudIds(r.data.data, 0);
          }
          resolve(r.data);
        } else {
          reject({ errCode: -1, errMsg: 'HTTP ' + r.statusCode + ' 返回数据异常' });
        }
      },
      fail: err => {
        const msg = (err && err.errMsg) || 'request:fail';
        reject({ errCode: -1, errMsg: msg });
      }
    });
  });
}

/**
 * 统一上传入口：本地后端 / 云存储二选一。
 * 云模式 resolve fileID（cloud://…）；本地模式 resolve 完整 URL（http://…/files/xxx.jpg）。
 * 两者都能直接放进 <image src>，数据库里存哪个由当前模式决定，无需上层关心。
 */
function upFile({ cloudPath, filePath }) {
  if (!USE_LOCAL) {
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({ cloudPath, filePath, success: r => resolve(r.fileID), fail: reject });
    });
  }
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: LOCAL_BASE + '/upload',
      filePath: filePath,
      name: 'file',
      success: r => {
        try {
          const body = JSON.parse(r.data);
          if (body && body.code === 0 && body.data && body.data.url) {
            resolve(LOCAL_HOST + body.data.url);
          } else {
            reject({ errCode: -1, errMsg: (body && body.msg) || '上传失败' });
          }
        } catch (e) {
          reject({ errCode: -1, errMsg: 'HTTP ' + r.statusCode + ' 上传返回异常' });
        }
      },
      fail: err => reject({ errCode: -1, errMsg: (err && err.errMsg) || 'uploadFile:fail' })
    });
  });
}

function call(name, data = {}, opts = {}) {
  // silent 表示"不打扰用户"，本就不该弹全屏遮罩（mask:true 会锁死交互 ~800ms，
  // 造成列表加载时整页卡住、像响应很慢）。因此只有非 silent 的调用才弹遮罩；
  // 提交类操作不传 silent（或显式 loading:true）即保留原有遮罩，行为不变。
  const showLoading = opts.silent !== true;
  if (showLoading) wx.showLoading({ title: opts.title || '加载中', mask: true });
  return new Promise((resolve, reject) => {
    callFn(name, data)
      .then(result => {
        wx.hideLoading();
        if (result) {
          if (result.code === 0) {
            resolve(result.data);
          } else {
            reject({ code: result.code, msg: result.msg || '请求失败' });
            if (opts.silent !== true) {
              wx.showToast({ title: result.msg || '请求失败', icon: 'none' });
            }
          }
        } else {
          reject({ code: -1, msg: '返回数据异常' });
        }
      })
      .catch(err => {
        wx.hideLoading();
        // 完整打印 err（含 errCode/errMsg/stack），便于开发者工具/真机调试排查
        try {
          console.error('[cloud.call fail]', name, JSON.stringify({
            errCode: err && err.errCode,
            errMsg: err && (err.errMsg || err.message),
            stack: err && err.stack
          }));
        } catch (_) {}
        const raw = (err && (err.errMsg || err.message)) || '';
        const code = err && err.errCode;
        // wx.cloud.callFunction 有时会把内层信息裹在外层 errMsg 里
        // （"cloud.callFunction:fail Error: errCode: -N | errMsg: ..."），
        // 外层 errCode 经常被吞成 -1，**真实错误码必须从内层解析**，否则命中不到分支。
        let innerCode = null;
        let innerMsg = '';
        const nested = raw.match(/errCode:\s*(-?\d+)\s*\|\s*errMsg:\s*([^\n]*?)(?=Error:|errCode:|$)/);
        if (nested) {
          innerCode = parseInt(nested[1], 10);
          innerMsg = nested[2].trim();
        }
        // 优先取 innerCode（嵌套的真实错误码），外层兜底
        const realCode = innerCode != null ? innerCode : code;
        let userMsg;
        // 本地后端模式：连接不上时给出针对性提示（而不是误导用户去部署云函数）
        if (USE_LOCAL && /request:fail|ECONNREFUSED|timeout|网络/i.test(raw)) {
          userMsg = '连不上本地后端 ' + LOCAL_HOST + '，请先启动 mall-server（IDEA 运行 MallServerApplication）';
        } else if (realCode === -501000
          || /FUNCTION_NOT_FOUND|FunctionName[^\n]*?(?:could not be found|not found)/i.test(raw + innerMsg)) {
          userMsg = `云函数「${name}」未部署，请在开发者工具右键云函数目录 → 上传并部署`;
        } else if (realCode === -501003
          || /FUNCTION_EXECUTE_ERROR|execution (?:error|fail)/i.test(raw + innerMsg)) {
          userMsg = `云函数「${name}」执行异常，请看开发者工具控制台`;
        } else if (realCode === -504003
          || /Invoking task timed out|FUNCTIONS_TIME_LIMIT_EXCEEDED|InvokeService (?:fail|timeout)|TimeoutError/i.test(raw + innerMsg)) {
          // -504003：云函数实例响应超时/无响应（云函数执行超过后台 timeout，或客户端等待超过其限制）
          userMsg = `云函数「${name}」响应超时，请稍后再试`;
        } else if (realCode === -502005
          || /Db or Table not exist|502005/i.test(raw + innerMsg)) {
          userMsg = '数据库集合缺失，请联系管理员';
        } else if (/request:fail|timeout|network/i.test(raw)) {
          userMsg = '网络异常，请检查网络后重试';
        } else if (/TOO_FREQUENT|too (?:many|frequent)/i.test(raw + innerMsg)) {
          userMsg = '操作太频繁，请稍后再试';
        } else if (realCode != null && realCode !== -1) {
          userMsg = `云函数「${name}」调用失败（错误码 ${realCode}），请稍后再试`;
        } else if (innerMsg && innerMsg.length < 30) {
          userMsg = `云函数「${name}」调用失败：${innerMsg}`;
        } else if (raw) {
          // 兜底：把 raw 头一段展示给用户，至少比"网络异常"更可定位
          const trimmed = raw.slice(0, 60).replace(/\s+/g, ' ');
          userMsg = `云函数「${name}」调用失败：${trimmed}`;
        } else {
          userMsg = '网络异常，请稍后再试';
        }
        reject({ code: realCode != null ? realCode : -1, msg: userMsg, raw, innerMsg, realCode });
        if (opts.silent !== true) {
          wx.showToast({ title: userMsg, icon: 'none', duration: 2500 });
        }
      });
  });
}

module.exports = { call, callFn, upFile, USE_LOCAL, LOCAL_HOST, LOCAL_BASE };