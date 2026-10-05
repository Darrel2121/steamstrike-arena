import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  console.log('[CDP] Testing wrecked automaton visual rendering on canvas...');
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9226',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--inprivate',
    '--window-size=1280,800',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_wreck_visual',
    'http://localhost:3000/'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));

    const res = await fetch('http://127.0.0.1:9226/json');
    const targets = await res.json();
    let pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
    if (!pageTarget) pageTarget = targets.find(t => t.type === 'page');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let msgId = 1;
    const pending = new Map();

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.on('message', (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id && pending.has(resp.id)) {
        const cb = pending.get(resp.id);
        pending.delete(resp.id);
        cb(resp);
      }
    });

    await new Promise(resolve => ws.on('open', resolve));

    await send('Runtime.enable');
    await send('Page.enable');

    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 1500));

    // 1. Enter match
    await send('Runtime.evaluate', {
      expression: `(() => {
        document.getElementById('btnHeroQuickPlay').click();
      })()`
    });

    await new Promise(r => setTimeout(r, 1200));

    // 2. Position player and spawn a destroyed bot right in the lantern light
    await send('Runtime.evaluate', {
      expression: `(() => {
        const app = window.app;
        const local = app.networkClient.getLocalPredictedPlayer();
        if (local) {
          // Point local player towards bot
          local.x = 400;
          local.y = 300;
          local.angle = 0; // facing right

          // Register a wrecked bot right in front of player
          app.gameRenderer.registerWreck({
            id: 'bot_fallen_1',
            name: 'Automaton_Scout',
            x: 520,
            y: 300,
            angle: 0.8,
            isBot: true
          });

          // Show in-canvas kill notification
          app.gameRenderer.addNotification('⚡ Automaton_Scout знищено!', { type: 'kill', color: '#ffcf48' });
        }
      })()`
    });

    await new Promise(r => setTimeout(r, 500));

    // 3. Capture screenshot
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    if (screenshot?.result?.data) {
      fs.writeFileSync('d:\\!Annet_game\\wreck_visual_screenshot.png', Buffer.from(screenshot.result.data, 'base64'));
      console.log('[CDP] Screenshot saved to wreck_visual_screenshot.png');
    }

    ws.close();
  } finally {
    edge.kill();
  }
}

run().catch(console.error);
