import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9228',
    '--disable-gpu',
    '--no-first-run',
    '--inprivate',
    '--window-size=1280,1050',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_test_scroll',
    'http://localhost:3000/'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://127.0.0.1:9228/json');
    const targets = await res.json();
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let msgId = 1;
    const send = (m, p = {}) => new Promise(r => {
      const id = msgId++;
      const onMsg = (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.id === id) { ws.off('message', onMsg); r(msg); }
      };
      ws.on('message', onMsg);
      ws.send(JSON.stringify({ id, method: m, params: p }));
    });
    await new Promise(r => ws.on('open', r));
    await send('Runtime.enable');
    await send('Page.enable');

    await new Promise(r => setTimeout(r, 1000));

    // Click online mode
    await send('Runtime.evaluate', { expression: "document.getElementById('btnModeOnline').click()" });
    await new Promise(r => setTimeout(r, 1000));

    const check = await send('Runtime.evaluate', {
      expression: "document.getElementById('homeRoomsList').innerHTML",
      returnByValue: true
    });
    console.log('homeRoomsList innerHTML:\n', check.result?.result?.value);

    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const imgData = ss.result?.data || ss.data;
    if (imgData) {
      fs.writeFileSync('d:\\!Annet_game\\home_online_full_view.png', Buffer.from(imgData, 'base64'));
      console.log('Saved home_online_full_view.png');
    } else {
      console.log('No screenshot data in response:', ss);
    }
    ws.close();
  } finally {
    edge.kill();
  }
}

run().catch(console.error);
