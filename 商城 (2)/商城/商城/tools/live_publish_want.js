// tools/live_publish_want.js
// 单测「发布求购」真机流程：聚焦上次 flaky 的那一项。
// 用法：node tools/live_publish_want.js

const automator = require('miniprogram-automator');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (ok, msg) => console.log(`${ok ? '✅' : '❌'} ${msg}`);

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  } catch (e) {
    console.error('❌ 连不上开发者工具，先跑：npm run devtools:auto');
    process.exit(1);
  }
  console.log('✅ 已连接\n');

  try {
    await mp.switchTab('/pages/publish/publish');
    await sleep(3500);
    let pg = await mp.currentPage();
    await pg.callMethod('setType', { currentTarget: { dataset: { type: 'want' } } });
    await sleep(800);
    await pg.callMethod('onTitle', { detail: { value: '自动化求购复验' + Date.now() } });
    await pg.callMethod('onDesc', { detail: { value: '脚本自动写入，可忽略' } });
    await pg.callMethod('selectCat', { currentTarget: { dataset: { key: 'book' } } });
    await pg.callMethod('toggleAgree');
    await sleep(500);
    let d = await pg.data();
    console.log(`   提交前：type=${d.form.type} cat=${d.form.category} agreed=${d.agreed}`);
    await pg.callMethod('submit');
    // 给足时间（含可能的限流重试）
    await sleep(9000);
    const cur = await mp.currentPage();
    const path = cur.path || '';
    const d2 = await cur.data();
    const sErr = d2.submitError || '';
    log(path.includes('index'), `发布求购：当前页=${path}${sErr ? ' | submitError=' + sErr : ''}`);
    if (path.includes('index')) {
      // 确认首页真的多了一条求购
      const home = await mp.currentPage();
      const hd = await home.data();
      console.log(`   首页当前 type=${hd.type}，列表 ${(hd.list || []).length} 件`);
    }
  } catch (e) {
    log(false, `发布求购异常: ${e.message.slice(0, 120)}`);
  }

  process.exit(0);
})().catch(e => { console.error('❌ 脚本异常', e.message); process.exit(1); });
