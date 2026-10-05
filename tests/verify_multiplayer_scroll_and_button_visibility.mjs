import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { PROTOCOL_MSG_TYPES, serializePacket } from '../shared/Protocol.js';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SERVER_URL = 'ws://localhost:3000';

async function run() {
  console.log('[CDP] Starting Host Multiplayer Scroll & Button Visibility Verification...');

  const roomId = 'StressHost_Chamber';
  const dummySockets = [];

  // Launch Edge as Host
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9229',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--inprivate',
    '--window-size=1100,680',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_scroll_test',
    `http://localhost:3000/?room=${roomId}`
  ]);

  try {
    await new Promise(r => setTimeout(r, 2500));

    const res = await fetch('http://127.0.0.1:9229/json');
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

    // Wait for host to connect
    await new Promise(r => setTimeout(r, 1500));

    // Connect 3 companions
    console.log('[CDP] Connecting 3 companion players...');
    for (let i = 1; i <= 3; i++) {
      const compWs = new WebSocket(SERVER_URL);
      dummySockets.push(compWs);
      await new Promise((resolve) => {
        compWs.on('open', () => {
          compWs.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, {
            roomId,
            playerName: `Ranger_Guest_${i}`
          }));
          resolve();
        });
        compWs.on('error', () => resolve());
      });
    }

    await new Promise(r => setTimeout(r, 1500));

    // Verify view-lobby overflow styling, player count, start button placement
    const evalResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const viewLobby = document.getElementById('view-lobby');
        const statusCard = document.getElementById('lobbyStatusCard');
        const startBtn = document.getElementById('btnStartMatch');
        const readyBtn = document.getElementById('btnToggleReady');
        const playerList = document.getElementById('lobbyPlayerList');
        const players = Array.from(document.querySelectorAll('#lobbyPlayerList .lobby-player-item')).map(el => el.textContent);
        const style = window.getComputedStyle(viewLobby);

        const startRect = startBtn.getBoundingClientRect();
        const cardRect = statusCard.getBoundingClientRect();

        return {
          viewOverflowY: style.overflowY,
          viewClientHeight: viewLobby.clientHeight,
          viewScrollHeight: viewLobby.scrollHeight,
          isScrollActive: viewLobby.scrollHeight > viewLobby.clientHeight,
          statusCardVisible: statusCard.style.display !== 'none',
          playersRendered: players.length,
          playersList: players,
          startBtnVisible: style.display !== 'none' && startBtn.style.display !== 'none',
          startBtnText: startBtn.textContent,
          startBtnTop: startRect.top,
          startBtnBottom: startRect.bottom,
          statusCardBottom: cardRect.bottom
        };
      })()`,
      returnByValue: true
    });

    console.log('[CDP] Lobby scroll & button evaluation:', evalResult?.result?.result?.value || evalResult);

    // Scroll down to reveal full roster and action buttons
    await send('Runtime.evaluate', {
      expression: `document.getElementById('view-lobby').scrollTop = 220;`
    });
    await new Promise(r => setTimeout(r, 400));

    // Capture screenshot of lobby scrolled down revealing start button
    const ssLobbyScrolled = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('d:\\!Annet_game\\multiplayer_lobby_scrolled.png', Buffer.from(ssLobbyScrolled.result.data, 'base64'));
    console.log('✔ Captured multiplayer_lobby_scrolled.png');

    const scrollCheck = await send('Runtime.evaluate', {
      expression: `document.getElementById('view-lobby').scrollTop`,
      returnByValue: true
    });
    console.log('[CDP] Verified scrollTop after scroll attempt:', scrollCheck?.result?.result?.value);

    ws.close();
  } finally {
    edge.kill();
    dummySockets.forEach(s => s.close());
  }
}

run().catch(err => {
  console.error('[CDP] Error:', err);
  process.exit(1);
});
