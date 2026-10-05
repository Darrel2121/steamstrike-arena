import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  console.log('Launching Edge for movement jitter diagnosis...');
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_jitter',
    'http://localhost:3000'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const res = await fetch('http://127.0.0.1:9222/json');
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

    // Wait for full init
    await new Promise(r => setTimeout(r, 1000));

    // Hook reconcile and log errorDist
    await send('Runtime.evaluate', {
      expression: `(() => {
        window.reconcileLogs = [];
        const origReconcile = window.app.networkClient.reconcile.bind(window.app.networkClient);
        window.app.networkClient.reconcile = function(serverState, tick, snapshotTimestamp) {
          const prevX = this.predictedX;
          const prevY = this.predictedY;
          origReconcile(serverState, tick, snapshotTimestamp);
          const dx = this.predictedX - prevX;
          const dy = this.predictedY - prevY;
          const dist = Math.hypot(dx, dy);
          window.reconcileLogs.push({
            tick,
            ackSeq: serverState.lastProcessedSeq,
            clientSeq: this.sequenceNumber,
            pendingCount: this.pendingInputs.length,
            serverX: serverState.x,
            serverY: serverState.y,
            prevX: Math.round(prevX * 100) / 100,
            newPredX: Math.round(this.predictedX * 100) / 100,
            snapDist: Math.round(dist * 1000) / 1000
          });
        };

        // Start solo match
        document.getElementById('btnHeroQuickPlay').click();
      })()`
    });

    // Wait 800ms for match to start
    await new Promise(r => setTimeout(r, 800));

    const startPos = await send('Runtime.evaluate', {
      expression: `({
        x: window.app.networkClient.predictedX,
        y: window.app.networkClient.predictedY,
        seq: window.app.networkClient.sequenceNumber,
        keys: Array.from(window.app.inputManager.keys)
      })`,
      returnByValue: true
    });
    console.log('Start Pos:', startPos.result?.value);

    // Simulate holding 'KeyA' (moving left into wall) for 1500ms
    await send('Runtime.evaluate', {
      expression: `(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
      })()`
    });

    await new Promise(r => setTimeout(r, 1500));

    const wallPos = await send('Runtime.evaluate', {
      expression: `({
        x: window.app.networkClient.predictedX,
        y: window.app.networkClient.predictedY,
        seq: window.app.networkClient.sequenceNumber,
        snaps: window.reconcileLogs.filter(l => l.snapDist > 0.05).slice(-10)
      })`,
      returnByValue: true
    });
    console.log('Wall collision Pos and Snaps:', wallPos.result?.value);

    // Release 'KeyA'
    await send('Runtime.evaluate', {
      expression: `(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true }));
      })()`
    });

    await new Promise(r => setTimeout(r, 500));

    // Fetch reconcile logs and stats
    const logsRes = await send('Runtime.evaluate', {
      expression: `({
        snapsOverHalfPx: window.reconcileLogs.filter(l => l.snapDist > 0.5),
        totalJitterSnaps: window.reconcileLogs.length,
        maxSnapDist: Math.max(...window.reconcileLogs.map(l => l.snapDist)),
        clientSpeed: window.app.networkClient.playerSpeed,
        currentView: window.app.currentView
      })`,
      returnByValue: true
    });

    console.log('Jitter Diagnostic Result:');
    console.log(JSON.stringify(logsRes.result?.value || logsRes, null, 2));

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
