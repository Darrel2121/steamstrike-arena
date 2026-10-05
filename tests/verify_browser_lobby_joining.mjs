import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  console.log('[CDP] Launching Edge to test lobby discovery, rooms browser, and ?room= auto-join...');
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9227',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--inprivate',
    '--window-size=1280,900',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_lobby_profile',
    'http://localhost:3000/?room=Sector_Aether'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2500));

    const res = await fetch('http://127.0.0.1:9227/json');
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

    await new Promise(r => setTimeout(r, 2000));

    // Verify current view and room input
    const evalResult1 = await send('Runtime.evaluate', {
      expression: `({
        currentView: window.app ? window.app.currentView : null,
        roomInput: document.getElementById('roomInput') ? document.getElementById('roomInput').value : null,
        lobbyStatusDisplay: document.getElementById('lobbyStatusCard') ? document.getElementById('lobbyStatusCard').style.display : null,
        lobbyRoomTitle: document.getElementById('lobbyRoomTitle') ? document.getElementById('lobbyRoomTitle').textContent : null,
        hasCopyCodeBtn: Boolean(document.getElementById('btnCopyRoomCode')),
        hasCopyLinkBtn: Boolean(document.getElementById('btnCopyRoomLink')),
        hasLobbyRoomsList: Boolean(document.getElementById('lobbyRoomsList')),
        roomsCount: document.querySelectorAll('#lobbyRoomsList .room-card').length
      })`,
      returnByValue: true
    });

    console.log('[CDP] Lobby check result:', evalResult1.result.value);

    // Test clicking "Посилання для друга"
    await send('Runtime.evaluate', {
      expression: `document.getElementById('btnCopyRoomLink').click();`
    });

    await new Promise(r => setTimeout(r, 600));

    // Take screenshot of Lobby
    const ssLobby = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('d:\\!Annet_game\\lobby_rooms_and_join_screenshot.png', Buffer.from(ssLobby.result.data, 'base64'));
    console.log('✔ Captured lobby_rooms_and_join_screenshot.png');

    // Test switching to Home and selecting online mode
    await send('Runtime.evaluate', {
      expression: `
        window.app.switchView('home');
        document.getElementById('btnModeOnline').click();
      `
    });

    await new Promise(r => setTimeout(r, 1200));

    const evalResultHome = await send('Runtime.evaluate', {
      expression: `({
        currentView: window.app.currentView,
        homeRoomFieldDisplay: document.getElementById('homeRoomField').style.display,
        homeRoomsCount: document.querySelectorAll('#homeRoomsList .room-card').length,
        hasHomeJoinBtn: Boolean(document.getElementById('btnHomeJoinRoom')),
        hasHomeCreateBtn: Boolean(document.getElementById('btnHomeCreateRoom'))
      })`,
      returnByValue: true
    });

    console.log('[CDP] Home online view check result:', evalResultHome.result.value);

    // Take screenshot of Home view with online rooms list
    const ssHome = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('d:\\!Annet_game\\home_online_rooms_screenshot.png', Buffer.from(ssHome.result.data, 'base64'));
    console.log('✔ Captured home_online_rooms_screenshot.png');

    ws.close();
  } finally {
    edge.kill();
  }
}

run().catch(err => {
  console.error('[CDP] Error:', err);
  process.exit(1);
});
