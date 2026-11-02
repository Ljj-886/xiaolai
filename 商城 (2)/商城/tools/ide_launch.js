// 用 automator 自带 launch 启动 IDE（自己指定 --auto-port，与 automator 握手兼容）
const path = require('path');
const Automator = require('miniprogram-automator');

const CLI = 'D:\\weixinkaifa\\微信web开发者工具\\cli.bat';
const projectPath = path.join(__dirname, '..');

(async () => {
  console.log('launching IDE via Automator (auto-port 9420) …');
  const mp = await Automator.launch({
    cliPath: CLI,
    projectPath,
    timeout: 120000
  });
  console.log('✅ IDE launched & connected.');
  // 保持连接，打印项目信息
  try {
    const info = await mp.evaluate(() => ({ appid: __wxConfig && __wxConfig.appid, env: wx.cloud && 'ok' }));
    console.log('project info:', JSON.stringify(info));
  } catch (e) { console.log('info probe skip:', e.message); }
  // 不关闭，维持会话（脚本退出即释放，但 IDE 仍在）
  console.log('connected. wsEndpoint handled internally.');
})().catch(e => { console.error('LAUNCH FATAL', e); process.exit(1); });
