import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
  console.log('Testing Editor Decors & Sizing via CDP...');
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=9224',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=d:\\!Annet_game\\.tmp_edge_editor',
    'http://localhost:3000'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const res = await fetch('http://127.0.0.1:9224/json');
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

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    if (parsed.id && pending.has(parsed.id)) {
      const cb = pending.get(parsed.id);
      pending.delete(parsed.id);
      cb(parsed.result);
    }
  });

  ws.on('open', async () => {
    await send('Runtime.enable');

    await new Promise(r => setTimeout(r, 1000));

    // Open map editor
    await send('Runtime.evaluate', {
      expression: `(() => {
        document.getElementById('btnHeroDesignMap').click();
      })()`
    });

    await new Promise(r => setTimeout(r, 500));

    // Check editor loaded and new tools available
    const toolsCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const editor = window.app.editor;
        const crackBtn = document.querySelector('[data-tool="crack"]');
        const signBtn = document.querySelector('[data-tool="sign"]');
        const bushBtn = document.querySelector('[data-tool="bush"]');
        const sizeSelect = document.getElementById('gridSizeSelect');

        // Test placing crack at (5, 5)
        editor.setActiveTool('crack');
        editor.applyTool(5, 5);

        // Test placing sign at (6, 6)
        editor.setActiveTool('sign');
        editor.applyTool(6, 6);

        // Test placing bush at (7, 7)
        editor.setActiveTool('bush');
        editor.applyTool(7, 7);

        // Test resizing grid to 32x32
        editor.resizeGrid(32, 32);

        return {
          currentView: window.app.currentView,
          hasCrackBtn: !!crackBtn,
          hasSignBtn: !!signBtn,
          hasBushBtn: !!bushBtn,
          sizeOptionsCount: sizeSelect.options.length,
          mapWidth: editor.map.width,
          mapHeight: editor.map.height,
          decorationsCount: editor.map.decorations.length,
          hasCrack: editor.map.decorations.some(d => d.type === 'crack'),
          hasSign: editor.map.decorations.some(d => d.type === 'sign'),
          hasBush: editor.map.decorations.some(d => d.type === 'bush'),
          validation: editor.lastValidation
        };
      })()`,
      returnByValue: true
    });

    console.log('Editor Test Result:', JSON.stringify(toolsCheck, null, 2));

    await ws.close();
    edge.kill();
    process.exit(0);
  });
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
