// tools/live_perf_verify.js
// 真机验证本轮性能优化：
//  1) 首页商品图片：列表只解析封面（light 模式）—— 断言 cover 为 https、images 保留 cloud://
//  2) 聊天：chat.send 返回真实 _id；chat.messages 支持 since 增量（无新消息返回空）
//  3) 页面回归：首页 / 聊天页正常加载
// 用法：先 `cli auto --project "D:\商城" --auto-port 9420` 激活自动化，再 node 本脚本。
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const WS = 'ws://localhost:9420';
const wait = ms => new Promise(r => setTimeout(r, ms));

function evalSafe(mp, fn, ...args) {
  const p = mp.evaluate(fn, ...args)
    .then(v => v)
    .catch(e => ({ __evalErr: String((e && e.message) || e) }));
  return Promise.race([p, new Promise(res => setTimeout(() => res({ __timeout: true }), 20000))]);
}
function callCF(mp, name, data) {
  return evalSafe(mp, (name, data) => new Promise(resolve => {
    wx.cloud.callFunction({
      name, data,
      success: r => resolve(r && r.result ? r.result : { __raw: r }),
      fail: e => resolve({ __fail: (e && (e.errMsg || e.message)) || String(e) })
    });
  }), name, data);
}
async function reLaunch(mp, url) {
  return evalSafe(mp, u => new Promise(res => {
    wx.reLaunch({ url: u, success: () => res('ok'), fail: e => res('fail:' + (e && e.errMsg || e)) });
  }), url);
}
function timedCall(mp, name, data) {
  const t0 = Date.now();
  return callCF(mp, name, data).then(r => ({ ms: Date.now() - t0, r }));
}

(async () => {
  const out = {};
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS, projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
    console.log('[connect] ok');
    await wait(3000);
    console.log('[warmup]', JSON.stringify(await evalSafe(mp, () => 1 + 1)));
    await evalSafe(mp, () => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e', traceUser: true }); } catch (e) {} return true; });
    await wait(500);

    // ===== 1) goods.list：只解析封面 =====
    // 取更大页，尽量包含「多图商品」才能显出优化：多图商品的非封面图应保持 cloud://（未解析）
    const c1 = await timedCall(mp, 'goods', { action: 'list', page: 1, pageSize: 50 });
    const list1 = (c1.r && c1.r.data && c1.r.data.list) || [];
    const coverResolved = list1.filter(g => g.cover && String(g.cover).indexOf('https') === 0).length;
    const coverTotal = list1.filter(g => g.cover).length;
    const multi = list1.filter(g => (g.images || []).length >= 2);
    const multiImgsTotal = multi.reduce((n, g) => n + (g.images || []).length, 0);
    const multiImgsUnresolved = multi.reduce((n, g) => n + (g.images || []).filter(f => String(f).indexOf('cloud://') === 0).length, 0);
    out.goodsList = {
      coldMs: c1.ms,
      count: list1.length,
      coverTotal, coverResolved,
      multiCount: multi.length,
      multiImgsTotal, multiImgsUnresolved,
      // 多图商品里，除封面（images[0]，与 cover 同 fileID）外的图片应保持 cloud://
      lightOK: multi.length
        ? multiImgsUnresolved >= (multiImgsTotal - multi.length)
        : 'no-multi-image-item(单图商品无法体现差异)'
    };
    console.log('[goods.list cold]', JSON.stringify(out.goodsList));

    const c2 = await timedCall(mp, 'goods', { action: 'list', page: 1, pageSize: 20 });
    out.goodsList.warmMs = c2.ms;
    console.log('[goods.list warm] ms=' + c2.ms);

    // ===== 2) chat：增量拉取 + send 返回 _id =====
    const convs = await callCF(mp, 'chat', { action: 'convs' });
    const convList = (convs && convs.data && convs.data.list) || [];
    out.chat = { convCount: convList.length };
    if (convList.length) {
      const c = convList[0];
      const peer = (c.participants || []).find(p => p !== undefined) || '';
      const peerOpenid = (c.participants || []).find(p => p !== (c.participants || [])[0]) || (c.participants || [])[0];
      const goodsId = c.goodsId;
      const mFull = await timedCall(mp, 'chat', { action: 'messages', convId: c._id });
      const fullList = (mFull.r && mFull.r.data && mFull.r.data.list) || [];
      const lastTs = fullList.reduce((mx, m) => Math.max(mx, m.createdAt || 0), 0);
      const mInc = await timedCall(mp, 'chat', { action: 'messages', convId: c._id, since: lastTs });
      const incList = (mInc.r && mInc.r.data && mInc.r.data.list) || [];
      out.chat = {
        convCount: convList.length,
        fullMs: mFull.ms, fullCount: fullList.length,
        incMs: mInc.ms, incCount: incList.length,
        incFlag: !!(mInc.r && mInc.r.data && mInc.r.data.incremental),
        lastTs
      };
      console.log('[chat.messages]', JSON.stringify(out.chat));
      out._ctx = { convId: c._id, peerOpenid, goodsId };
    } else {
      console.log('[chat] 无会话，跳过增量验证');
    }

    // 发送验证：用「一次性合成会话」验证 chat.send 返回真实 _id，随后整体删除，零污染
    const realGoodsId = list1[0] && list1[0]._id;
    if (realGoodsId) {
      const fakePeer = 'autotest_' + Date.now();
      const send = await callCF(mp, 'chat', {
        action: 'send', peerOpenid: fakePeer, goodsId: realGoodsId, type: 'text', content: '【自动化测试】性能验证'
      });
      const sentConvId = send && send.data && send.data.convId;
      out.chatSend = {
        code: send && send.code,
        hasId: !!(send && send.data && send.data._id),
        _id: send && send.data && send.data._id,
        sentAt: send && send.data && send.data.sentAt,
        convId: sentConvId
      };
      console.log('[chat.send]', JSON.stringify(out.chatSend));
      // 清理：整段删除合成会话（含其全部消息），不留痕
      if (sentConvId) {
        const del = await callCF(mp, 'chat', { action: 'deleteConversation', convId: sentConvId });
        out.chatSend.cleaned = !!(del && del.code === 0);
        console.log('[chat.send cleanup]', out.chatSend.cleaned);
      }
    }

    // ===== 3) 页面回归：首页 / 聊天页 =====
    await reLaunch(mp, '/pages/index/index'); await wait(2500);
    const idx = await evalSafe(mp, () => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      if (!p) return { none: true };
      return { route: p.route, list: (p.data.list || []).length, loading: p.data.loading, loadError: p.data.loadError || '', sig: (p.data.list || []).map(x => x._id).join(',').slice(0, 40) };
    });
    out.pageIndex = idx;
    console.log('[page index]', JSON.stringify(idx));

    if (out._ctx && out._ctx.convId) {
      const url = `/pages/chatroom/chatroom?convId=${out._ctx.convId}&peer=${out._ctx.peerOpenid}&goodsId=${out._ctx.goodsId}`;
      await reLaunch(mp, url); await wait(2500);
      const chat = await evalSafe(mp, () => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        if (!p) return { none: true };
        return { route: p.route, msgCount: (p.data.messages || []).length };
      });
      out.pageChatroom = chat;
      console.log('[page chatroom]', JSON.stringify(chat));
    }

    // 首页二次进入（模拟 onShow 缓存命中）：断言不闪、有列表
    await reLaunch(mp, '/pages/index/index'); await wait(1200);
    const idx2 = await evalSafe(mp, () => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p && p.route, list: (p && p.data.list || []).length };
    });
    out.pageIndex2 = idx2;
    console.log('[page index 2nd]', JSON.stringify(idx2));

  } catch (e) {
    out.fatal = String((e && e.stack) || e);
    console.error('[fatal]', out.fatal);
  } finally {
    if (mp) try { await mp.close(); } catch (e) {}
  }
  delete out._ctx;
  console.log('\n===== RESULT =====');
  console.log(JSON.stringify(out, null, 2));
})();
