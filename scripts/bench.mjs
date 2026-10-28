// Runs the render benchmark (src/bench.js, page ?bench=1) in a headless Chrome and prints a table.
//   node scripts/bench.mjs [url]     url defaults to http://localhost:8765/?bench=1 (start the server first)
//   CHROME=/path/to/chrome           browser to use (default: Google Chrome on macOS)
// Needs a GPU-capable Chrome; results depend on the machine, so compare runs on the same one.
import { spawn } from 'node:child_process';

const url = process.argv[2] || 'http://localhost:8765/?bench=1';
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, '--headless=new', '--window-size=1024,768', '--force-device-scale-factor=2',
  '--user-data-dir=' + (process.env.TMPDIR || '/tmp') + `/funny-faces-bench-${port}`, '--no-first-run', '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable');
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send('Page.navigate', { url });
  for (let i = 0; i < 240; i++) { await sleep(1000); if (await evalJs('window.__benchProgress') === 'done') break; }
  const out = await evalJs('window.__bench');
  if (!out) throw new Error('No result: is the server running and does the page open?');
  console.log(`canvas ${out.size.join('x')}, ${out.mode}, ${await evalJs('navigator.userAgent')}`);
  console.log('quality  n  px   voice   work avg/p95 (ms)   tile avg   frame gap avg/p95   fps');
  for (const r of out.rows)
    console.log(`${r.quality.padEnd(7)} ${String(r.n).padStart(2)} ${String(r.px).padStart(4)}  ${(r.talk ? 'talk' : 'quiet').padEnd(5)}   ${String(r.work.avg).padStart(6)} / ${String(r.work.p95).padEnd(6)}   ${String(r.tile.avg).padStart(7)}   ${String(r.frameGap.avg).padStart(6)} / ${String(r.frameGap.p95).padEnd(6)}   ${r.fps}`);
  ws.close();
} finally { proc.kill(); }
