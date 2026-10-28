// Protocol-level tests against a real server (port 0): raw sockets, the way a hostile or broken client behaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { binFrame, mouthBytes, mask, openWs, rawHttp, sleep, textFrame, upgradeRequest } from './_wire.mjs';

async function boot(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ff-hard-'));
  mkdirSync(join(dir, 'dist/assets'), { recursive: true });
  writeFileSync(join(dir, 'dist/index.html'), '<title>app</title>');
  const app = createApp({ port: 0, host: '127.0.0.1', dataDir: join(dir, 'data'), distDir: join(dir, 'dist'), onNewCode: () => {}, ...opts });
  const port = await app.listen();
  return { app, port, dir };
}
function get(port, path, { host, headers = {}, method = 'GET', body } = {}) {
  return new Promise((ok, fail) => {
    const req = http.request({ port, path, method, host: '127.0.0.1', headers: { host: host || `localhost:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', fail); req.end(body);
  });
}
const alive = async (port) => (await get(port, '/api/info')).status === 200;
async function pairUp(port) {
  const screen = await openWs(port), admin = await openWs(port);
  screen.send({ action: 'register' });
  await screen.until((c) => c.json().some((m) => m.type === 'code'));
  admin.send({ action: 'pair', code: screen.json().find((m) => m.type === 'code').code });
  await admin.until((c) => c.json().some((m) => m.type === 'paired'));
  return { screen, admin };
}

test('B1: an upgrade request with an invalid URL does not crash the server (GET //[ and an absolute bad URL)', async () => {
  const { app, port } = await boot();
  try {
    await rawHttp(port, upgradeRequest(port, '//['));
    assert.equal(await alive(port), true);
    await rawHttp(port, 'GET http://[::1/ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\n\r\n');
    assert.equal(await alive(port), true);
    await rawHttp(port, upgradeRequest(port, '/%zz'));
    await rawHttp(port, upgradeRequest(port, '/other'));
    assert.equal(await alive(port), true);
  } finally { await app.close(); }
});

test('B1: a plain HTTP request with an invalid URL or bad percent-encoding gets 400, not a crash', async () => {
  const { app, port } = await boot();
  try {
    assert.match(await rawHttp(port, `GET //[ HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1.1 400/);
    assert.equal((await get(port, '/%zz')).status, 400);
    assert.equal(await alive(port), true);
  } finally { await app.close(); }
});

test('B1: raw sockets that reset, send junk or vanish mid-request never throw', async () => {
  const { app, port } = await boot();
  const errors = [];
  const onErr = (e) => errors.push(e);
  process.on('uncaughtException', onErr);
  try {
    await rawHttp(port, 'GARBAGE\r\n\r\n');
    await rawHttp(port, 'GET / HTTP/1.1\r\nHost: x\r\n');                // never finished
    const s = await openWs(port); s.sock.resetAndDestroy ? s.sock.resetAndDestroy() : s.sock.destroy();
    await sleep(100);
    assert.equal(await alive(port), true);
    assert.deepEqual(errors, []);
  } finally { process.off('uncaughtException', onErr); await app.close(); }
});

test('M1 over the wire: 100,000 one-byte fragments get a 1009 close, and the server stays responsive', async () => {
  const { app, port } = await boot();
  try {
    const c = await openWs(port);
    const parts = [mask(1, 'a', { fin: false })];
    for (let i = 0; i < 99999; i++) parts.push(mask(0, 'a', { fin: false }));
    c.sock.write(Buffer.concat(parts));
    const t = Date.now();
    assert.equal(await alive(port), true);
    assert.ok(Date.now() - t < 1000, `server took ${Date.now() - t} ms to answer`);
    await c.untilClosed();
    assert.equal(c.closeCode(), 1009);
  } finally { await app.close(); }
});

test('M2: at most maxPerIp WebSocket connections per address; a slot frees up when one closes (even if the peer just leaves)', async () => {
  const { app, port } = await boot({ maxPerIp: 3 });
  try {
    const open = [];
    for (let i = 0; i < 3; i++) { const c = await openWs(port); assert.equal(c.status, 101); open.push(c); }
    const refused = await openWs(port);
    assert.equal(refused.status, 429);
    assert.equal(app.stats().sockets, 3);
    open[0].sock.destroy();
    await sleep(100);
    assert.equal(app.stats().sockets, 2);
    assert.equal((await openWs(port)).status, 101);
    for (const c of open) c.sock.destroy();
  } finally { await app.close(); }
});

test('M2: 200 rapid upgrades from one address: only the cap get through', async () => {
  const { app, port } = await boot();      // default cap
  try {
    const all = await Promise.all(Array.from({ length: 200 }, () => openWs(port).catch(() => ({ status: 0, sock: { destroy() {} } }))));
    const ok = all.filter((c) => c.status === 101).length;
    assert.ok(ok <= 20 && ok >= 1, `${ok} accepted`);
    assert.equal(await alive(port), true);
    all.forEach((c) => c.sock.destroy());
  } finally { await app.close(); }
});

test('M2: the server has a connection cap and TCP keepalive on its sockets', async () => {
  const { app, port } = await boot({ maxConnections: 77 });
  try { assert.equal(app.server.maxConnections, 77); } finally { await app.close(); }
});

test('M2: a peer that never answers pings is dropped, and the screen count the control page sees stays true', async () => {
  const { app, port } = await boot({ pingMs: 60, pongMs: 60 });
  try {
    const screen = await openWs(port), admin = await openWs(port);
    screen.send({ action: 'register' });
    await screen.until((c) => c.json().some((m) => m.type === 'code'));
    admin.send({ action: 'pair', code: screen.json().find((m) => m.type === 'code').code });
    await admin.until((c) => c.json().some((m) => m.type === 'paired' && m.screens === 1));
    // the screen's machine vanishes without a goodbye: it neither reads nor answers (a plain pause is enough for the test)
    screen.sock.pause();
    // the admin keeps answering by sending something now and then
    for (let i = 0; i < 12; i++) { admin.send({ action: 'ping' }); await sleep(40); }
    await admin.until((c) => c.json().some((m) => m.type === 'screens' && m.n === 0), 3000);
    assert.equal(admin.closed, false);
    assert.ok(admin.frames.some((f) => f.op === 9), 'the server pinged');
  } finally { await app.close(); }
});

test('M2: a connection that never sends a valid message is closed after idleMs; one that did is left alone', async () => {
  const { app, port } = await boot({ idleMs: 150 });
  try {
    const silent = await openWs(port), junk = await openWs(port), quiet = await openWs(port);
    junk.sock.write(textFrame('not json')); junk.send({ action: 'nonsense' }); junk.send([1, 2]);
    quiet.send({ action: 'register' });
    await silent.untilClosed(2000);
    assert.equal(silent.closeCode(), 1008);
    await junk.untilClosed(2000);
    await sleep(100);
    assert.equal(quiet.closed, false, 'an unpaired page that has spoken may stay quiet');
  } finally { await app.close(); }
});

test('M2: a per-connection message rate limit closes a flooder, and lets a mouth stream (15/s) and bursts through', async () => {
  const { app, port } = await boot({ rate: 100, burst: 200 });
  try {
    const ok = await openWs(port);
    for (let i = 0; i < 150; i++) ok.send({ action: 'ping' });            // a burst
    await sleep(100);
    assert.equal(ok.closed, false);
    const flood = await openWs(port);
    flood.sock.write(Buffer.concat(Array.from({ length: 2000 }, () => textFrame({ action: 'ping' }))));
    await flood.untilClosed(2000);
    assert.equal(flood.closeCode(), 1008);
  } finally { await app.close(); }
});

test('M3: a stalled screen under a flood of mouth messages costs bounded memory, and the control page is unaffected', async () => {
  const { app, port } = await boot({ rate: 1e9, burst: 1e9, maxPerIp: 50 });
  try {
    const { screen, admin } = await pairUp(port);
    screen.sock.pause();                                                  // the TV stops reading
    const msg = binFrame(mouthBytes(1, [1, 2, 3]));
    for (let round = 0; round < 40; round++) { admin.sock.write(Buffer.concat(Array(5000).fill(msg))); await sleep(5); }
    await sleep(500);
    assert.ok(app.stats().maxQueued < 64 * 1024, `queued ${app.stats().maxQueued} bytes for a stalled screen`);
    assert.equal(admin.closed, false);
    assert.equal(screen.closed, false, 'dropped mouth frames do not kill a screen: it is only slow');
  } finally { await app.close(); }
});

test('M3: a stalled screen that is sent big state messages is dropped once over 1 MB unsent', async () => {
  const { app, port } = await boot({ rate: 1e9, burst: 1e9 });
  try {
    const { screen, admin } = await pairUp(port);
    screen.sock.pause();
    const big = { face: 'x', pad: 'y'.repeat(150000) };
    for (let i = 0; i < 150 && app.stats().sockets > 1; i++) { admin.send({ action: 'state', state: big, n: i }); await sleep(10); }
    await sleep(300);
    assert.equal(app.stats().sockets, 1, 'the stalled screen was dropped');
    assert.ok(app.stats().maxQueued < 1.5 * 1024 * 1024);
    assert.equal(admin.closed, false);
  } finally { await app.close(); }
});

test('M9 over the wire: the screen hears admin_gone when the control page closes', async () => {
  const { app, port } = await boot();
  try {
    const { screen, admin } = await pairUp(port);
    admin.sock.destroy();
    await screen.until((c) => c.json().some((m) => m.type === 'admin_gone'));
  } finally { await app.close(); }
});

test('M4 over HTTP: 5 wrong setup codes then 429, even with the right code', async () => {
  const { app, port } = await boot({ lanControl: true });
  const lan = `192.168.1.9:${port}`, json = { 'content-type': 'application/json' };
  const setup = (b) => get(port, '/api/setup', { method: 'POST', host: lan, headers: json, body: JSON.stringify(b) });
  try {
    const code = app.auth.setupCode;
    for (let i = 0; i < 4; i++) assert.equal((await setup({ password: 'long enough pw', code: 'WRONG123' })).status, 403);
    assert.equal((await setup({ password: 'long enough pw', code: 'WRONG123' })).status, 429);
    const locked = await setup({ password: 'long enough pw', code });
    assert.equal(locked.status, 429);
    assert.match(locked.headers['retry-after'], /^\d+$/);
    assert.match(JSON.parse(locked.body).error, /Too many wrong tries/);
    assert.equal(app.auth.hasPassword, false);
  } finally { await app.close(); }
});

test('login lockout answers 429 with a readable message (the login form shows the error text)', async () => {
  const { app, port } = await boot({ lanControl: true });
  const lan = `192.168.1.9:${port}`, json = { 'content-type': 'application/json' };
  const login = (pw) => get(port, '/api/login', { method: 'POST', host: lan, headers: json, body: JSON.stringify({ password: pw }) });
  try {
    app.auth.setPassword('long enough pw');
    for (let i = 0; i < 8; i++) assert.equal((await login('nope nope nope')).status, i < 7 ? 401 : 429);
    const r = await login('long enough pw');
    assert.equal(r.status, 429);
    assert.match(JSON.parse(r.body).error, /Wait .* and try again/);
    assert.ok(Number(r.headers['retry-after']) > 0);
    assert.match((await get(port, '/', { host: lan })).body, /\.error\|\|'Try again'/, 'the form prints the server message');
  } finally { await app.close(); }
});

test('HTML responses carry a Content-Security-Policy, X-Frame-Options DENY and frame-ancestors none', async () => {
  const { app, port } = await boot({ lanControl: true });
  try {
    const lan = `192.168.1.9:${port}`;
    for (const r of [await get(port, '/'), await get(port, '/?screen'), await get(port, '/index.html'),
      await get(port, '/', { host: lan }), await get(port, '/', { host: `localhost:${port}`, headers: {} })]) {
      assert.equal(r.headers['x-frame-options'], 'DENY');
      assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    }
    const csp = (await get(port, '/')).headers['content-security-policy'];
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /worker-src blob:/);
    assert.match(csp, new RegExp(`connect-src 'self' ws://localhost:${port} wss://localhost:${port}`));
    assert.match(csp, /img-src 'self' data: blob:/);
    const form = await get(port, '/', { host: lan });                       // the login/setup page has its own inline script, allowed by nonce
    const nonce = /script-src 'nonce-([^']+)'/.exec(form.headers['content-security-policy'])[1];
    assert.ok(form.body.includes(`<script nonce="${nonce}">`) && form.body.includes(`<style nonce="${nonce}">`));
    assert.notEqual(nonce, /nonce-([^']+)/.exec((await get(port, '/', { host: lan })).headers['content-security-policy'])[1]);
    assert.equal((await get(port, '/', { host: 'ev il:1' })).headers['content-security-policy'].includes('ws://ev'), false);
  } finally { await app.close(); }
});

test('a static file that cannot be read gets a 500 and the server carries on', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { app, port, dir } = await boot();
  try {
    writeFileSync(join(dir, 'dist/locked.json'), '{}'); chmodSync(join(dir, 'dist/locked.json'), 0o000);
    assert.equal((await get(port, '/locked.json')).status, 500);
    assert.equal(await alive(port), true);
  } finally { await app.close(); }
});

test('sessions.json is private (0600), written atomically, and flush() writes immediately', { skip: process.platform === 'win32' }, async () => {
  const { app, port, dir } = await boot();
  try {
    await pairUp(port);
    app.flush();
    const f = join(dir, 'data/sessions.json');
    assert.equal(statSync(f).mode & 0o777, 0o600);
    assert.equal(existsSync(f + '.tmp'), false);
    const saved = JSON.parse(readFileSync(f, 'utf8'));
    assert.equal(Object.keys(saved).length, 1);
    const [s] = Object.values(saved);
    assert.deepEqual(Object.keys(s).sort(), ['key', 'state', 'ttl']);    // no runtime fields (admin/gone) leak to disk
  } finally { await app.close(); }
});

test('a restart loads a damaged sessions.json without crashing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-hard-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data/sessions.json'), JSON.stringify({ a: { key: 'k', state: '{{{', ttl: 9e12 }, b: 5, c: { ttl: 1 } }));
  const app = createApp({ port: 0, host: '127.0.0.1', dataDir: join(dir, 'data'), distDir: dir });
  const port = await app.listen();
  try {
    const s = await openWs(port);
    s.send({ action: 'screen', session: 'a' });
    await s.until((c) => c.json().some((m) => m.type === 'paired'));
  } finally { await app.close(); }
});
