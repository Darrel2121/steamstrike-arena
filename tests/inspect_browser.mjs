import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  console.log('Launching headless Edge for comprehensive button test...');
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_profile_2',
    'http://localhost:3000/'
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

    // Test 1: Random Callsign Dice Button
    const callsignTest = await send('Runtime.evaluate', {
      expression: `(() => {
        const input = document.getElementById('homePlayerNameInput');
        const before = input.value;
        document.getElementById('btnRandomCallsign').click();
        const after = input.value;
        return { before, after, changed: before !== after };
      })()`,
      returnByValue: true
    });
    console.log('1. Callsign Dice Button:', JSON.stringify(callsignTest.result.value));

    // Test 2: Mode Toggle Buttons
    const modeTest = await send('Runtime.evaluate', {
      expression: `(() => {
        const btnOnline = document.getElementById('btnModeOnline');
        const btnSolo = document.getElementById('btnModeSolo');
        btnOnline.click();
        const onlineActive = btnOnline.classList.contains('active');
        const heroModeOnline = window.app.heroMode;
        btnSolo.click();
        const soloActive = btnSolo.classList.contains('active');
        const heroModeSolo = window.app.heroMode;
        return { onlineActive, heroModeOnline, soloActive, heroModeSolo };
      })()`,
      returnByValue: true
    });
    console.log('2. Mode Toggle Buttons:', JSON.stringify(modeTest.result.value));

    // Test 3: Nav Buttons Switching
    const navTest = await send('Runtime.evaluate', {
      expression: `(() => {
        const views = [];
        document.getElementById('navBtnLobby').click();
        views.push(window.app.currentView);
        document.getElementById('navBtnWorkshop').click();
        views.push(window.app.currentView);
        document.getElementById('navBtnEditor').click();
        views.push(window.app.currentView);
        document.getElementById('navBtnHome').click();
        views.push(window.app.currentView);
        return { sequence: views };
      })()`,
      returnByValue: true
    });
    console.log('3. Nav Buttons Switching:', JSON.stringify(navTest.result.value));

    // Test 4: Launch Solo Match from Hero button
    const launchTest = await send('Runtime.evaluate', {
      expression: `(async () => {
        console.log('Testing click on btnHeroQuickPlay...');
        const btn = document.getElementById('btnHeroQuickPlay');
        console.log('btnHeroQuickPlay exists:', Boolean(btn));
        btn.click();
        console.log('Clicked btnHeroQuickPlay. Network connected:', window.app.networkClient?.isConnected);
        await new Promise(r => setTimeout(r, 1000));
        console.log('After 1000ms: view =', window.app.currentView, 'gameLoopActive =', window.app.gameLoopActive);
        return {
          currentView: window.app.currentView,
          gameLoopActive: window.app.gameLoopActive,
          localPlayerId: window.app.localPlayerId,
          activeCanvas: document.getElementById('gameCanvas')?.width
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('4. Launch Solo Match:', JSON.stringify(launchTest.result.value));

    ws.close();
    edge.kill();
  });

  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER]', msg.params.type, msg.params.args.map(a => a.value || a.description).join(' '));
    }
  });
}

run().catch(console.error);
