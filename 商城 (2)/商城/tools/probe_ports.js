const WebSocket = require('ws');
const ports = [9420, 23653, 29602];
(async () => {
  for (const p of ports) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${p}`);
      const result = await Promise.race([
        new Promise(r => ws.once('open', () => r({ port: p, open: true }))),
        new Promise(r => setTimeout(() => r({ port: p, open: false, timeout: true }), 1500)),
        new Promise(r => ws.once('error', e => r({ port: p, error: e.message })))
      ]);
      console.log(p, '→', JSON.stringify(result));
      if (result.open) ws.close();
    } catch (e) { console.log(p, '→', 'thrown', e.message); }
  }
})();
