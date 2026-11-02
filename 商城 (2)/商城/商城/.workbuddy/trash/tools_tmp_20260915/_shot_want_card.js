// tools/_shot_want_card.js —— 截求购卡片新卡面
const automator = require('miniprogram-automator');
const path = require('path');
const PROJECT = path.join(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420', projectPath: PROJECT, cwd: PROJECT, timeout: 30000 });
  await wait(2500);
  const call = async (n, d) => mp.evaluate((nn, dd) => wx.cloud.callFunction({ name: nn, data: dd }).then(r => r.result).catch(e => ({ __err: String((e && e.errMsg) || e) })), n, d);
  await mp.evaluate(() => { try { wx.cloud.init({ env: 'cloud1-d6gxmdbcqf5d51f3e' }); } catch (e) {} return true; });

  // 造一条无图求购，便于截图
  const pub = await call('goods', { action: 'publish', title: '求购一台二手平板', desc: '想收个 iPad 用于看网课，预算 1500', images: [], price: '1500', category: 'digital', type: 'want' });
  const wid = pub && pub.data && pub.data._id;
  console.log('created:', wid);
  if (wid) await call('admin', { action: 'reviewGoods', id: wid, pass: true });

  await mp.switchTab('/pages/index/index');
  await wait(3000);
  await mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    if (p && p.setListType) p.setListType({ currentTarget: { dataset: { type: 'want' } } });
  }).catch(() => {});
  await wait(3200);
  try { await mp.screenshot({ path: path.join(__dirname, '_want_card_new.png') }); console.log('shot ok'); } catch (e) { console.log('shot fail', e.message); }

  if (wid) { const d = await call('goods', { action: 'remove', id: wid }); console.log('cleanup:', JSON.stringify(d)); }
  process.exit(0);
})();
