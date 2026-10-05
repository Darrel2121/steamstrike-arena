import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9236',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1280,800',
    '--user-data-dir=d:\\!Annet_game\\.tmp_chrome_battle2',
    'http://localhost:3000/'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://127.0.0.1:9236/json');
    const targets = await res.json();
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let msgId = 1;
    const send = (m, p = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(() => {
        ws.off('message', onMsg);
        reject(new Error('CDP command timeout: ' + m));
      }, 10000);
      const onMsg = (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.off('message', onMsg);
          resolve(msg);
        }
      };
      ws.on('message', onMsg);
      ws.send(JSON.stringify({ id, method: m, params: p }));
    });

    await new Promise(r => ws.on('open', r));
    await send('Runtime.enable');
    await send('Page.enable');

    await new Promise(r => setTimeout(r, 1200));

    console.log('Invoking launchSoloTraining()...');
    await send('Runtime.evaluate', {
      expression: `
        if (window.app) {
          window.app.launchSoloTraining();
        }
      `
    });

    // Wait 3.5s for game loop & match ticks
    await new Promise(r => setTimeout(r, 3500));

    console.log('Capturing screenshot...');
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const imgData = ss.result?.data || ss.data;
    if (imgData) {
      fs.writeFileSync('d:\\!Annet_game\\battle_arena_hd.png', Buffer.from(imgData, 'base64'));
      console.log('Successfully saved d:\\!Annet_game\\battle_arena_hd.png');
    } else {
      console.log('No screenshot data received');
    }

    ws.close();
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    chrome.kill();
  }
}

run();
