// utils/cloud.js
// 统一封装云函数调用与错误处理。
//
// 关键升级：按 errCode 精确判断（云开发标准错误码 -501000/-501003/-502005 等），
// 不再依赖 errMsg 字符串模糊匹配（旧版本漏掉了 "could not be found"、"execution fail"
// 等变体，导致所有未知错误一律降级为"网络异常，请稍后再试"，用户/开发者都摸不着头脑）。
//
// 兜底策略：把 raw 头一段展示给用户，至少比纯"网络异常"更有信息量；
// 同时 console.error 完整打印 errCode/errMsg/stack，便于开发者工具真机排查。

function call(name, data = {}, opts = {}) {
  const showLoading = opts.loading !== false;
  if (showLoading) wx.showLoading({ title: opts.title || '加载中', mask: true });
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({ name, data })
      .then(res => {
        wx.hideLoading();
        if (res && res.result) {
          if (res.result.code === 0) {
            resolve(res.result.data);
          } else {
            reject({ code: res.result.code, msg: res.result.msg || '请求失败' });
            if (opts.silent !== true) {
              wx.showToast({ title: res.result.msg || '请求失败', icon: 'none' });
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
        // 优先按 errCode 精确判断（云开发返回的真正错误码）
        if (realCode === -501000
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

module.exports = { call };