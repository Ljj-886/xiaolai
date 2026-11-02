// tools/diag_layout.js — 真实几何 + 截图，面板用 page.setData，避开截图导致连接卡死
const path = require('path');
const { spawn } = require('child_process');
const Automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CLI = 'D:\\weixinkaifa\\微信web开发者工具\\cli.bat';
const projectPath = path.join(__dirname, '..');
const PORT = 9425;
const OUT = 'D:/商城/.workbuddy/tmp';

async function startIDE() {
  return new Promise((resolve, reject) => {
    const p = spawn('cmd.exe', ['/c', CLI, 'auto', '--project', projectPath, '--auto-port', String(PORT)],
      { detached: true, stdio: 'ignore', windowsHide: true });
    p.on('error', reject); p.unref(); resolve();
  });
}
async function connectWithRetry() {
  const dl = Date.now() + 90000;
  while (Date.now() < dl) {
    try { return await Automator.connect({ wsEndpoint: 'ws://localhost:' + PORT, timeout: 60000 }); }
    catch (e) { await sleep(1500); }
  }
  throw new Error('连接超时');
}
async function geo(page, sel) {
  const el = await page.$(sel);
  if (!el) return null;
  try {
    const off = await el.offset(); const sz = await el.size();
    return { left: Math.round(off.left), top: Math.round(off.top),
      right: Math.round(off.left + sz.width), bottom: Math.round(off.top + sz.height),
      h: Math.round(sz.height), w: Math.round(sz.width) };
  } catch (e) { return { error: e.message }; }
}
async function ping(page) {
  try { await page.data(); return true; } catch (e) { return false; }
}
function rule(label, cond, detail) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ' :: ' + detail : ''}`);
  return cond;
}

(async () => {
  console.log('启动 IDE …');
  await startIDE();
  const mp = await connectWithRetry();
  console.log('✅ 已连接');
  const errors = [];
  mp.on('console', m => { if (m.type === 'error') errors.push(m.args.join(' ')); });

  await mp.reLaunch('/pages/chat/chat'); await sleep(3000);
  const chat = await mp.currentPage();
  const list = ((await chat.data()).list) || [];
  if (!list.length) { console.log('❌ 没有会话'); await mp.disconnect(); process.exit(1); }
  const conv = list[0];
  const peer = (conv.participants || []).find(p => p) || '';
  console.log('进入会话:', conv._id);

  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId || ''}`);
  await sleep(3500);
  let page = await mp.currentPage();
  console.log('chatroom loaded: title=', JSON.stringify((await page.data()).title));

  const vp0 = await geo(page, '.page');
  const origin = vp0 ? vp0.top : 0;
  console.log('\n视口:', JSON.stringify(vp0), 'origin=', origin);
  const rel = g => g ? { top: g.top - origin, bottom: g.bottom - origin, h: g.h } : null;

  // 状态 A：只测，不截图（避免截图后连接卡死）
  console.log('\n=== 状态 A：正常（仅测量）===');
  const ml0 = rel(await geo(page, '.msg-list'));
  const ib0 = rel(await geo(page, '.input-bar'));
  console.log('  msg-list :', JSON.stringify(ml0));
  console.log('  input-bar:', JSON.stringify(ib0));
  let okA = true;
  if (vp0 && ib0) okA = rule('输入栏在视口底部', ib0.bottom <= vp0.h + 2, `ib.bottom=${ib0.bottom} vp.h=${vp0.h}`) && okA;
  if (ml0) okA = rule('消息区在视口内(top>=0)', ml0.top >= -1, `ml.top=${ml0.top}`) && okA;

  // 状态 B
  console.log('\n=== 状态 B：表情面板 ===');
  let okB = true;
  console.log('  ping 连接 …');
  console.log('    ping:', await ping(page) ? '✅' : '❌');
  console.log('  page.setData({ showEmoji: true, showPlus: false })');
  await page.setData({ showEmoji: true, showPlus: false });
  console.log('  setData ok, sleep 900');
  await sleep(900);
  page = await mp.currentPage();
  const dB = await page.data();
  console.log('  showEmoji=', !!dB.showEmoji, ' currentEmojis#=', (dB.currentEmojis || []).length);
  const mlB = rel(await geo(page, '.msg-list'));
  const epB = rel(await geo(page, '.emoji-panel'));
  const etB = rel(await geo(page, '.emoji-tabs'));
  const esB = rel(await geo(page, '.emoji-scroll'));
  const egB = rel(await geo(page, '.emoji-grid'));
  const ibB = rel(await geo(page, '.input-bar'));
  console.log('  msg-list    :', JSON.stringify(mlB));
  console.log('  emoji-panel :', JSON.stringify(epB));
  console.log('  emoji-tabs  :', JSON.stringify(etB));
  console.log('  emoji-scroll:', JSON.stringify(esB));
  console.log('  emoji-grid  :', JSON.stringify(egB));
  console.log('  input-bar   :', JSON.stringify(ibB));
  // 截图放在所有测量之后
  await mp.screenshot({ path: OUT + '/layout_emoji.png' });
  console.log('  📷 emoji 截图完成');
  if (mlB && epB) okB = rule('消息区与表情面板无重叠', mlB.bottom <= epB.top + 1, `ml.bottom=${mlB.bottom} ep.top=${epB.top}`) && okB;
  if (epB && ibB) okB = rule('表情面板不覆盖输入栏', epB.bottom <= ibB.top + 1, `ep.bottom=${epB.bottom} ib.top=${ibB.top}`) && okB;
  if (epB && vp0) okB = rule('表情面板不超视口底', epB.bottom <= vp0.h + 2, `ep.bottom=${epB.bottom} vp.h=${vp0.h}`) && okB;
  if (etB && epB) okB = rule('分类条在面板内', etB.top >= epB.top - 1, `et.top=${etB.top} ep.top=${epB.top}`) && okB;
  if (esB && epB) okB = rule('表情网格在面板内', esB.bottom <= epB.bottom + 1, `es.bottom=${esB.bottom} ep.bottom=${epB.bottom}`) && okB;
  await sleep(300);

  // 状态 C
  console.log('\n=== 状态 C：「+」面板 ===');
  let okC = true;
  console.log('  ping 连接 …', await ping(page) ? '✅' : '❌');
  console.log('  page.setData({ showEmoji: false, showPlus: true })');
  await page.setData({ showEmoji: false, showPlus: true });
  console.log('  setData ok, sleep 900');
  await sleep(900);
  page = await mp.currentPage();
  const dC = await page.data();
  console.log('  showPlus=', !!dC.showPlus);
  const mlC = rel(await geo(page, '.msg-list'));
  const ppC = rel(await geo(page, '.plus-panel'));
  const ibC = rel(await geo(page, '.input-bar'));
  console.log('  msg-list   :', JSON.stringify(mlC));
  console.log('  plus-panel :', JSON.stringify(ppC));
  console.log('  input-bar  :', JSON.stringify(ibC));
  await mp.screenshot({ path: OUT + '/layout_plus.png' });
  console.log('  📷 plus 截图完成');
  if (mlC && ppC) okC = rule('消息区与+面板无重叠', mlC.bottom <= ppC.top + 1, `ml.bottom=${mlC.bottom} pp.top=${ppC.top}`) && okC;
  if (ppC && ibC) okC = rule('+面板不覆盖输入栏', ppC.bottom <= ibC.top + 1, `pp.bottom=${ppC.bottom} ib.top=${ibC.top}`) && okC;
  if (ppC && vp0) okC = rule('+面板不超视口底', ppC.bottom <= vp0.h + 2, `pp.bottom=${ppC.bottom} vp.h=${vp0.h}`) && okC;

  // 复位
  await page.setData({ showEmoji: false, showPlus: false });

  console.log('\n=== 控制台错误 ===');
  if (!errors.length) console.log('  ✅ 0 条'); else errors.slice(0, 6).forEach(e => console.log('  ❌ ' + e.slice(0, 200)));

  console.log('\n==== 结论 ====');
  console.log('  状态A(正常):', okA ? '正常' : '有问题');
  console.log('  状态B(表情):', okB ? '无重叠/不溢出' : '❌ 布局错乱');
  console.log('  状态C(+面板):', okC ? '无重叠/不溢出' : '❌ 布局错乱');

  await mp.disconnect();
  process.exit((okA && okB && okC) ? 0 : 2);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });