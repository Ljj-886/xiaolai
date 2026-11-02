// 对比 localhost vs 127.0.0.1 的 automator 连接，定位"连不上 IDE"根因
const path = require('path');
const Automator = require('miniprogram-automator');
const projectPath = path.join(__dirname, '..');

(async () => {
  for (const ep of ['ws://127.0.0.1:9420', 'ws://localhost:9420']) {
    try {
      const mp = await Automator.connect({ wsEndpoint: ep, projectPath, cwd: projectPath, timeout: 20000 });
      console.log(`✅ ${ep} → 连接成功`);
      await mp.close();
    } catch (e) {
      console.log(`❌ ${ep} → ${(e && e.message || '').slice(0, 90)}`);
    }
  }
})();
