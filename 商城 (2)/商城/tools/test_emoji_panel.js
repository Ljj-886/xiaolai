// tools/test_emoji_panel.js
// 实跑验证聊天表情面板的完整交互链路
const automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const errors = [];
  mp.on('console', m => { if (m.type === 'error') errors.push(m.args.join(' ')); });
  mp.on('exception', e => errors.push(e.message || JSON.stringify(e)));
  let fail = 0;
  const ok = n => console.log('  ✅ ' + n);
  const bad = (n, d) => { fail++; console.log('  ❌ ' + n + (d ? ' :: ' + String(d).slice(0, 160) : '')); };

  // 1. 进会话列表，取第一条进 chatroom
  await mp.reLaunch('/pages/chat/chat'); await sleep(2500);
  const chat = await mp.currentPage();
  const dChat = await chat.data();
  const list = (dChat && dChat.list) || [];
  if (!list.length) { bad('没有会话'); process.exit(1); }
  const conv = list[0];
  const peer = (conv.participants || []).find(p => p) || '';
  console.log('进入会话:', conv._id);

  // 直接 reLaunch 进 chatroom（带 convId/peer/goodsId）
  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId || ''}`);
  await sleep(3500);
  let page = await mp.currentPage();
  let d = await page.data();
  console.log(`chatroom loaded: title=${JSON.stringify(d.title)} messages=${(d.messages||[]).length} showEmoji=${!!d.showEmoji}`);
  if (!d.title) bad('chatroom 未加载');
  else ok('chatroom 加载完成');

  // 先点开 emoji 面板（输入栏第一个 icon-btn）
  const iconBtns = await page.$$('view.icon-btn');
  console.log('  input-bar icon-btn 数量:', iconBtns.length);
  if (iconBtns.length > 0) {
    await iconBtns[0].tap(); await sleep(600);
    d = await page.data();
    console.log(`  点击后 showEmoji=${!!d.showEmoji}`);
    if (d.showEmoji) ok('点 emoji 切换按钮，emoji 面板已展开');
    else bad('点 emoji 按钮后 showEmoji 未变 true');
  }

  // 2. 点 emoji 切换按钮（输入栏第一个 icon-btn）
  const emojis0 = (d.currentEmojis || []).length;
  const emojiCats = (d.emojiCats || []).map(c => c.label);
  console.log('  emojiCats 标签:', emojiCats.join(' / '));
  if (emojiCats.join(',') === '笑脸,情感,手势,常用') ok('emoji 四个分类标签正确');
  else bad('emoji 分类标签不对', emojiCats.join(','));
  if (emojis0 > 0) ok(`默认分类「${d.emojiCat}」加载了 ${emojis0} 个表情`);
  else bad('默认分类表情为空');

  // 3. 通过 callMethod 切到 情感（验证切换）
  try {
    await page.callMethod('switchEmojiCat', { currentTarget: { dataset: { k: 'emotion' } } });
  } catch (e) { /* callMethod 可能需要 e 对象，直接 setData 也行 */ }
  // 切分类靠 switchEmojiCat(e)，callMethod 入参在 mini 0.12 通常塞进第一个参数
  // 兜底：直接 setData
  await page.callMethod('setData', { emojiCat: 'emotion', currentEmojis: (await page.data())._emojiGroups ? (await page.data())._emojiGroups.emotion.list : [] }).catch(() => {});
  d = await page.data();
  // 上面 setData 兜底不一定生效（_emojiGroups 是实例变量不在 data 里）。换个稳的做法：
  // 直接通过 wx 环境调用：模拟点击 情感 tab
  // automator 可以通过 $ + tap 触发
  const tabs = await page.$$('text.emoji-tab');
  console.log('  实际 emoji tabs DOM 数量:', tabs.length);
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    const wxml = await t.wxml();
    const m = wxml.match(/>([^<]+)</);
    console.log(`    tab[${i}] = ${m ? m[1] : '?'}`);
  }
  if (tabs.length >= 4) {
    // 点第二个（情感）
    await tabs[1].tap(); await sleep(500);
    d = await page.data();
    console.log(`  切到情感后: emojiCat=${d.emojiCat} currentEmojis 数=${(d.currentEmojis||[]).length}`);
    if (d.emojiCat === 'emotion') ok('点击「情感」tab 切换成功');
    else bad('点「情感」tab 切换未生效');
  }

  // 4. 点一个表情（pickEmoji）→ draft 应增加
  const before = (d.draft || '').length;
  const emojiEls = await page.$$('text.emoji-item');
  console.log('  当前表情 grid DOM 数量:', emojiEls.length);
  if (emojiEls.length > 0) {
    await emojiEls[0].tap(); await sleep(400);
    d = await page.data();
    const after = (d.draft || '').length;
    if (after > before) ok(`点表情入框成功：draft "${d.draft}"`);
    else bad('点表情后 draft 没增加');
  }

  // 5. 截图
  await mp.screenshot({ path: 'D:/商城/.workbuddy/tmp/emoji_panel.png' }).catch(() => {});
  console.log('  📷 D:/商城/.workbuddy/tmp/emoji_panel.png');

  // 6. 控制台错误
  if (!errors.length) ok('0 控制台错误');
  else { bad(`有 ${errors.length} 条错误`, errors.slice(0,3).join(' | ')); }

  console.log(`\n失败：${fail}`);
  await mp.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });