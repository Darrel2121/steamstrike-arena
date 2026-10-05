import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9238',
    '--disable-gpu',
    '--no-first-run',
    '--inprivate',
    '--window-size=1280,800',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_vis',
    'http://localhost:3000/'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://127.0.0.1:9238/json');
    const targets = await res.json();
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let msgId = 1;
    const send = (m, p = {}) => new Promise((resolve) => {
      const id = msgId++;
      const onMsg = (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.id === id) { ws.off('message', onMsg); resolve(msg); }
      };
      ws.on('message', onMsg);
      ws.send(JSON.stringify({ id, method: m, params: p }));
    });

    await new Promise(r => ws.on('open', r));
    await send('Runtime.enable');
    await send('Page.enable');

    await new Promise(r => setTimeout(r, 1500));

    console.log('Starting solo match...');
    await send('Runtime.evaluate', {
      expression: "window.app && window.app.launchSoloTraining()"
    });

    // Wait 3.5s for match to render
    await new Promise(r => setTimeout(r, 3500));

    console.log('Capturing battle arena screenshot...');
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const imgData = ss.result?.data || ss.data;
    if (imgData) {
      fs.writeFileSync('d:\\!Annet_game\\battle_arena_hd.png', Buffer.from(imgData, 'base64'));
      console.log('Saved d:\\!Annet_game\\battle_arena_hd.png successfully!');
    }

    ws.close();
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    edge.kill();
  }
}

run();
