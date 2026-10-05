import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  console.log('Diagnosing Shooting and HP at start...');
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9223',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_hp',
    'http://localhost:3000'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const res = await fetch('http://127.0.0.1:9223/json');
  const targets = await res.json();
  const pageTarget = targets.find(t => t.type === 'page');

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

  ws.on('open', async () => {
    await send('Runtime.enable');
    await send('Log.enable');

    await new Promise(r => setTimeout(r, 1000));

    // Click "Швидка гра" (Quick Play)
    await send('Runtime.evaluate', {
      expression: `(() => {
        document.getElementById('btnHeroQuickPlay').click();
      })()`
    });

    // Wait 500ms
    await new Promise(r => setTimeout(r, 500));

    // Check player state immediately
    const immediateState = await send('Runtime.evaluate', {
      expression: `(() => {
        try {
          const local = window.app.networkClient.getLocalPredictedPlayer();
          const latestSnap = window.app.networkClient.snapshotBuffer.length > 0
            ? window.app.networkClient.snapshotBuffer[window.app.networkClient.snapshotBuffer.length - 1].data
            : null;
          return {
            currentView: window.app.currentView,
            localPlayerId: window.app.localPlayerId,
            networkPlayerId: window.app.networkClient.playerId,
            local,
            latestSnap,
            isFiring: window.app.inputManager.isMouseDown
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()`,
      returnByValue: true
    });
    console.log('Immediate Match State (500ms):', immediateState);

    // Try shooting: simulate mousedown on canvas
    await send('Runtime.evaluate', {
      expression: `(() => {
        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: rect.left + 500,
          clientY: rect.top + 300
        }));
      })()`
    });

    // Wait 300ms
    await new Promise(r => setTimeout(r, 300));

    const shootingState = await send('Runtime.evaluate', {
      expression: `(() => {
        const local = window.app.networkClient.getLocalPredictedPlayer();
        const latestSnap = window.app.networkClient.snapshotBuffer.length > 0
          ? window.app.networkClient.snapshotBuffer[window.app.networkClient.snapshotBuffer.length - 1].data
          : null;
        return {
          isMouseDown: window.app.inputManager.isMouseDown,
          projectilesCount: latestSnap?.projectiles?.length || 0,
          soundEventsCount: latestSnap?.soundEvents?.length || 0,
          ammo: local?.ammo,
          hp: local?.hp,
          isAlive: local?.isAlive
        };
      })()`,
      returnByValue: true
    });
    console.log('Shooting State (800ms):', JSON.stringify(shootingState.result?.value, null, 2));

    // Wait 2000ms and check if bot attacked
    await new Promise(r => setTimeout(r, 2000));

    const state2s = await send('Runtime.evaluate', {
      expression: `(() => {
        const local = window.app.networkClient.getLocalPredictedPlayer();
        const latestSnap = window.app.networkClient.snapshotBuffer.length > 0
          ? window.app.networkClient.snapshotBuffer[window.app.networkClient.snapshotBuffer.length - 1].data
          : null;
        return {
          local,
          snapPlayers: latestSnap?.players
        };
      })()`,
      returnByValue: true
    });
    console.log('State at 2.8s:', JSON.stringify(state2s.result?.value, null, 2));

    ws.close();
    edge.kill();
  });

  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
}

run().catch(console.error);
