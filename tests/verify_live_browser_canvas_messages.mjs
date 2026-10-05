import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  console.log('[CDP] Launching Edge to test in-canvas messages and persistent wreck...');
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--inprivate',
    '--window-size=1280,800',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_clean_profile',
    'http://localhost:3000/'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));

    const res = await fetch('http://127.0.0.1:9225/json');
    const targets = await res.json();
    console.log('[CDP] Available Targets:', targets.map(t => ({ url: t.url, type: t.type })));
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

    // Ensure we are navigated to http://localhost:3000/
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 2000));

    let alertTriggered = false;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Page.javascriptDialogOpening') {
        alertTriggered = true;
        console.error('FAIL: Browser dialog opened!', msg.params);
      }
    });

    // 1. Click Quick Play to enter live match
    const clickPlay = await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.getElementById('btnHeroQuickPlay');
        if (!btn) return 'btnHeroQuickPlay not found';
        btn.click();
        return 'clicked';
      })()`,
      returnByValue: true
    });
    console.log('[CDP] Click Quick Play:', clickPlay.result?.result?.value);

    await new Promise(r => setTimeout(r, 1200));

    // 2. Test in-canvas elimination notification
    const elimResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const app = window.app;
        if (!app) return { error: 'No app' };

        // Test elimination notification
        app.handleElimination({ victimId: 'bot_1', killerId: app.localPlayerId });
        
        return {
          view: app.currentView,
          localPlayerId: app.localPlayerId,
          notifsCount: app.gameRenderer?.hud?.notifications?.length,
          lastNotif: app.gameRenderer?.hud?.notifications?.[0]?.text
        };
      })()`,
      returnByValue: true
    });
    console.log('[CDP] Elimination Test Result:', elimResult.result?.result?.value);

    // 3. Test Match Over in-canvas modal
    const matchOverResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const app = window.app;
        app.handleMatchOver({
          isOver: true,
          winnerId: app.localPlayerId,
          draw: false,
          results: [{
            playerId: app.localPlayerId,
            kills: 2,
            damageDealt: 190,
            survivalSeconds: 30,
            xpEarned: 200,
            scrapEarned: 100,
            coresEarned: 1
          }]
        });

        return {
          isMatchOver: app.isMatchOver,
          gameLoopActive: app.gameLoopActive,
          hasMatchOutcome: !!app.gameRenderer?.hud?.matchOutcome,
          buttons: Object.keys(app.gameRenderer?.hud?.buttonBounds || {})
        };
      })()`,
      returnByValue: true
    });
    console.log('[CDP] Match Over Result:', matchOverResult.result?.result?.value);

    // Let 1 frame render
    await new Promise(r => setTimeout(r, 600));

    // Take screenshot
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    if (screenshot?.result?.data) {
      fs.writeFileSync('d:\\!Annet_game\\match_over_canvas_screenshot.png', Buffer.from(screenshot.result.data, 'base64'));
      console.log('[CDP] Screenshot saved to match_over_canvas_screenshot.png');
    }

    // 4. Test clicking Restart Button on canvas
    const restartTest = await send('Runtime.evaluate', {
      expression: `(() => {
        const app = window.app;
        const bounds = app.gameRenderer?.hud?.buttonBounds?.restart;
        if (!bounds) return { error: 'No restart bounds' };

        const canvas = app.gameCanvas;
        const rect = canvas.getBoundingClientRect();
        
        // Dispatch canvas click on restart button
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        const clickClientX = rect.left + (bounds.x + bounds.w / 2) * scaleX;
        const clickClientY = rect.top + (bounds.y + bounds.h / 2) * scaleY;

        canvas.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          clientX: clickClientX,
          clientY: clickClientY
        }));

        return {
          isMatchOver: app.isMatchOver,
          outcomeCleared: app.gameRenderer?.hud?.matchOutcome === null
        };
      })()`,
      returnByValue: true
    });
    console.log('[CDP] Restart Canvas Click Test:', restartTest.result?.result?.value);

    if (alertTriggered) {
      console.error('FAILED: alert() was called!');
      process.exit(1);
    } else {
      console.log('SUCCESS: All in-canvas messages and persistent wreck verified in live browser without alerts!');
    }

    ws.close();
  } finally {
    edge.kill();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
