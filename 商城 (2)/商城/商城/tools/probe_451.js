// tools/probe_451.js —— 定性 HTTP 451：是整桶问题、单个文件问题，还是 imageMogr2 参数引起
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));
function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args).then(v => v).catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 30000))]);
}
function rawCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({ name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) }) });
  }), name, data);
}
// 逐个请求并把「状态码 + 响应体前 300 字」带回来
function probe(mp, items) {
  return evalSafe(mp, (items) => new Promise(resolve => {
    const out = []; let i = 0;
    const next = () => {
      if (i >= items.length) return resolve(out);
      const it = items[i++];
      wx.request({ url: it.url, method: 'GET', responseType: 'text',
        success: x => {
          const b = typeof x.data === 'string' ? x.data : JSON.stringify(x.data);
          out.push({ tag: it.tag, code: x.statusCode, ct: (x.header && (x.header['Content-Type'] || x.header['content-type'])) || '', kb: Math.round(b.length / 1024 * 10) / 10, body: b.slice(0, 300) });
          next();
        },
        fail: e => { out.push({ tag: it.tag, fail: String(e && e.errMsg || e) }); next(); } });
    };
    next();
  }), items);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    await wait(2500);
    await evalSafe(mp, () => 1 + 1);
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

    const gl = await rawCF(mp, 'goods', { action: 'list', page: 1, pageSize: 5 });
    const goods = ((gl.data && gl.data.list) || []).filter(g => g.cover);
    const c0 = goods[0] && goods[0].cover;

    const items = [];
    if (c0) {
      items.push({ tag: '商品图·带imageMogr2', url: c0 });
      items.push({ tag: '商品图·去掉imageMogr2(原始)', url: String(c0).split('&imageMogr2')[0] });
      const noQuery = String(c0).split('?')[0];
      items.push({ tag: '商品图·无任何签名参数', url: noQuery });
    }
    // 头像（另一个文件，验证是否整桶问题）
    const me = await rawCF(mp, 'user', { action: 'me' });
    const av = me.data && me.data.avatarUrl;
    if (av && String(av).indexOf('http') === 0) items.push({ tag: '我的头像', url: av });
    // 另一件商品
    if (goods[1]) items.push({ tag: '另一件商品图', url: goods[1].cover });

    const res = await probe(mp, items);
    console.log('===== 请求结果 =====');
    (res || []).forEach(r => {
      console.log(`\n【${r.tag}】`);
      console.log(`  code=${r.code} ${r.ct} ${r.kb}KB ${r.fail || ''}`);
      if (r.body) console.log('  body: ' + r.body.replace(/\s+/g, ' ').slice(0, 280));
    });

    console.log('\n===== 汇总 =====');
    (res || []).forEach(r => console.log(`  ${r.code || 'FAIL'}  ${r.tag}`));
  } catch (e) {
    console.log('异常：' + String((e && e.stack) || e));
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
})();
