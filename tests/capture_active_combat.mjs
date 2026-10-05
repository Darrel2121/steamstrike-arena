import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9248',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1280,800',
    '--user-data-dir=d:\\!Annet_game\\.tmp_chrome_vis7',
    'http://localhost:3000/'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://127.0.0.1:9248/json');
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

    console.log('Clicking btnHeroQuickPlay from Home...');
    await send('Runtime.evaluate', {
      expression: "document.getElementById('btnHeroQuickPlay').click()"
    });

    // Wait until gameLoopActive is true
    console.log('Waiting for active game loop...');
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      const chk = await send('Runtime.evaluate', {
        expression: "Boolean(window.app && window.app.gameLoopActive)",
        returnByValue: true
      });
      if (chk.result?.result?.value === true) {
        console.log(`Game loop active at ${(i + 1) * 250}ms!`);
        break;
      }
    }

    // Wait 1.5s into active live combat
    await new Promise(r => setTimeout(r, 1500));

    // Ensure idle overlay is hidden
    await send('Runtime.evaluate', {
      expression: "if (document.getElementById('gameIdleOverlay')) document.getElementById('gameIdleOverlay').style.display = 'none';"
    });

    console.log('Capturing live match gameplay screenshot...');
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const imgData = ss.result?.data || ss.data;
    if (imgData) {
      fs.writeFileSync('d:\\!Annet_game\\battle_arena_active_hd.png', Buffer.from(imgData, 'base64'));
      console.log('Saved d:\\!Annet_game\\battle_arena_active_hd.png successfully!');
    }

    ws.close();
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    chrome.kill();
  }
}

run();
