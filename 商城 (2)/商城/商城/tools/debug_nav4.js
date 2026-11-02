const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const r = await mp.evaluate(() => {
    const p = getCurrentPages();
    const last = p[p.length - 1];
    const nb = last.selectComponent && last.selectComponent('nav-bar');
    return { route: last.route, hasNavBar: !!nb, title: nb ? nb.data.title : null, back: nb ? nb.data.back : null };
  });
  console.log(JSON.stringify(r));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
