// server/main.js as a program: started from another folder, and stopped the way docker stop does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWs, sleep } from './_wire.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

async function start(env = {}, cwd = tmpdir()) {
  const port = await freePort(), data = mkdtempSync(join(tmpdir(), 'ff-main-'));
  const child = spawn(process.execPath, [join(root, 'server/main.js')], { cwd, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FACES_DATA: data, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((ok) => child.on('exit', (code, sig) => ok({ code, sig })));
  for (let i = 0; i < 100 && !/Funny Faces is running/.test(out) && child.exitCode === null; i++) await sleep(100);
  return { child, port, data, exited, out: () => out };
}

test('main.js works when started from another directory (builds and serves the page)', async () => {
  const s = await start();                                              // cwd is the system temp folder, not the project
  try {
    assert.match(s.out(), /Funny Faces is running/, s.out());
    const r = await fetch(`http://127.0.0.1:${s.port}/?screen`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<script type="module" src="assets\/app\.[0-9a-f]{10}\.js">/);
  } finally { s.child.kill('SIGKILL'); }
});

test('SIGTERM saves the sessions at once and exits 0 (docker stop)', { skip: process.platform === 'win32' }, async () => {
  const s = await start({ FACES_NO_BUILD: '1' });
  try {
    const screen = await openWs(s.port), admin = await openWs(s.port);
    screen.send({ action: 'register' });
    await screen.until((c) => c.json().some((m) => m.type === 'code'));
    admin.send({ action: 'pair', code: screen.json().find((m) => m.type === 'code').code });
    await admin.until((c) => c.json().some((m) => m.type === 'paired'));
    assert.equal(existsSync(join(s.data, 'sessions.json')), false, 'saving is normally delayed');
    s.child.kill('SIGTERM');
    const { code } = await s.exited;
    assert.equal(code, 0);
    assert.equal(Object.keys(JSON.parse(readFileSync(join(s.data, 'sessions.json'), 'utf8'))).length, 1);
  } finally { s.child.kill('SIGKILL'); }
});

test('a request-scoped error does not stop the server: it is logged and the server keeps running', async () => {
  const s = await start({ FACES_NO_BUILD: '1' });
  try {
    const raw = net.connect(s.port, '127.0.0.1'); raw.on('error', () => {});
    raw.end('GET //[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: a\r\n\r\n');
    await sleep(300);
    assert.equal(s.child.exitCode, null);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/info`)).status, 200);
  } finally { s.child.kill('SIGKILL'); }
});
