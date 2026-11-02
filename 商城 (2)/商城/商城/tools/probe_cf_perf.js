// 诊断云函数真实耗时：在小程序运行时内直接 wx.cloud.callFunction，
// 用内部 20s 上限确保 evaluate 一定返回（避免 automator 自身超时掩盖真实耗时）
const path = require('path');
const Automator = require('miniprogram-automator');
const projectPath = path.join(__dirname, '..');

const CASES = [
  { name: 'goods', label: 'goods.list', data: { action: 'list', page: 1, pageSize: 5, type: 'sell' } },
  { name: 'goods', label: 'goods.detail', data: { action: 'detail', id: 'e04f59456a9f771102dc84722888f359' } },
  { name: 'user', label: 'user.me', data: { action: 'me' } },
  { name: 'user', label: 'user.myFavs', data: { action: 'myFavs', page: 1, pageSize: 5 } },
  { name: 'school', label: 'school.list', data: { action: 'list' } }
];

(async () => {
  const mp = await Automator.connect({
    wsEndpoint: 'ws://localhost:9420',
    projectPath, cwd: projectPath, timeout: 30000
  });
  console.log('✅ connected\n');

  for (const c of CASES) {
    const r = await mp.evaluate(cc => new Promise(resolve => {
      const t0 = Date.now();
      const timer = setTimeout(() => resolve({ ok: false, dt: Date.now() - t0, err: 'CLIENT_TIMEOUT_20S' }), 20000);
      wx.cloud.callFunction({ name: cc.name, data: cc.data })
        .then(res => {
          clearTimeout(timer);
          const rs = res && res.result;
          resolve({
            ok: !!(rs && rs.code === 0),
            dt: Date.now() - t0,
            code: rs && rs.code,
            msg: rs && rs.msg ? String(rs.msg).slice(0, 100) : '',
            hasData: !!(rs && rs.data)
          });
        })
        .catch(e => {
          clearTimeout(timer);
          resolve({
            ok: false,
            dt: Date.now() - t0,
            errCode: e && e.errCode,
            errMsg: String((e && (e.errMsg || e.message)) || '').slice(0, 160)
          });
        });
    }), c);
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${c.label}  ${r.dt}ms  code=${r.code != null ? r.code : '-'} ${r.msg ? 'msg=' + r.msg : ''}${r.errCode ? ' errCode=' + r.errCode : ''}${r.errMsg ? ' errMsg=' + r.errMsg : ''}`);
    await new Promise(s => setTimeout(s, 800));
  }

  await mp.close();
  console.log('\ndone.');
})().catch(e => { console.error('FATAL', e && (e.message || e)); process.exit(1); });
