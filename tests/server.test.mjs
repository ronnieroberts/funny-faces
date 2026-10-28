import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Relay } from '../server/relay.js';
import { createApp } from '../server/index.js';
import { sameOrigin, isLocal } from '../server/auth.js';
import { mouthBytes } from './_wire.mjs';

function fakeConn(relay, id, adminOk) {
  const got = [];
  relay.connect(id, (o) => got.push(o), adminOk);
  return got;
}

test('a screen pairs with a code and then follows the control page', () => {
  const r = new Relay();
  const screen = fakeConn(r, 's', false), admin = fakeConn(r, 'a', true);
  r.handle('s', { action: 'register' });
  const code = screen[0].code;
  assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
  r.handle('a', { action: 'pair', code: code.toLowerCase() });
  assert.equal(admin.at(-1).type, 'paired');
  assert.equal(admin.at(-1).screens, 1);
  assert.equal(screen.at(-1).type, 'paired');
  r.handle('a', { action: 'state', state: { face: 'x' }, n: 1 });
  assert.deepEqual(screen.at(-1), { type: 'state', state: { face: 'x' }, n: 1 });
  const frame = mouthBytes(2, [1, 2, 3]);
  assert.equal(r.handleBinary('a', frame), true);
  assert.equal(screen.at(-1), frame);                                   // the very same bytes, not re-encoded
  assert.equal(r.handleBinary('a', mouthBytes(3, [1, 2])), false);      // a bad length is dropped
  assert.equal(screen.at(-1), frame);
  const late = fakeConn(r, 'late', false);                              // a screen that joins later gets the saved look
  r.handle('late', { action: 'screen', session: admin.at(-1).session });
  assert.equal(late.at(-1).type, 'state');
});

test('a code works once, wrong codes are counted, expired codes fail', () => {
  let t = 1000;
  const r = new Relay({ now: () => t });
  const screen = fakeConn(r, 's', false), admin = fakeConn(r, 'a', true);
  r.handle('s', { action: 'register' });
  const code = screen[0].code;
  r.handle('a', { action: 'pair', code: 'AAAAAA' });
  assert.equal(admin.at(-1).error, 'bad_code');
  t += 601;
  r.handle('a', { action: 'pair', code });
  assert.equal(admin.at(-1).error, 'bad_code');
  for (let i = 0; i < 12; i++) r.handle('a', { action: 'pair', code: 'AAAAAA' });
  assert.equal(admin.at(-1).error, 'too_many_attempts');
});

test('only a trusted connection may drive the faces', () => {
  const r = new Relay();
  const guest = fakeConn(r, 'g', false);
  for (const action of ['pair', 'admin', 'state', 'end']) r.handle('g', { action, code: 'ABCDEF', state: {} });
  r.handleBinary('g', mouthBytes(1, [0, 0, 0]));
  assert.ok(guest.every((o) => o.error === 'not_admin'));
  assert.equal(guest.length, 5);
});

test('saved sessions let a screen reconnect after a restart', () => {
  const store = {};
  const r1 = new Relay({ onSessions: (s) => Object.assign(store, JSON.parse(JSON.stringify(s))) });
  const s1 = fakeConn(r1, 's', false), a1 = fakeConn(r1, 'a', true);
  r1.handle('s', { action: 'register' });
  r1.handle('a', { action: 'pair', code: s1[0].code });
  const session = a1.at(-1).session;
  const r2 = new Relay({ sessions: store });
  const s2 = fakeConn(r2, 's', false);
  r2.handle('s', { action: 'screen', session });
  assert.equal(s2[0].type, 'paired');                                   // (then admin_gone: nobody controls it yet)
});

test('origin and host checks', () => {
  const req = (headers, addr = '127.0.0.1') => ({ headers, socket: { remoteAddress: addr } });
  assert.equal(sameOrigin(req({ host: 'a:1', origin: 'http://a:1' })), true);
  assert.equal(sameOrigin(req({ host: 'a:1', origin: 'http://evil.example' })), false);
  assert.equal(isLocal(req({ host: 'localhost:8765' })), true);
  assert.equal(isLocal(req({ host: 'evil.example' })), false);           // DNS rebinding
  assert.equal(isLocal(req({ host: 'localhost' }, '192.168.1.9')), false);
  assert.equal(isLocal(req({ host: 'localhost', 'x-forwarded-for': '1.2.3.4' })), false);
});

function get(port, path, { host, headers = {}, method = 'GET', body } = {}) {
  return new Promise((ok, fail) => {
    const req = http.request({ port, path, method, host: '127.0.0.1', headers: { host: host || `localhost:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

async function boot(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ff-'));
  mkdirSync(join(dir, 'dist/assets'), { recursive: true });
  writeFileSync(join(dir, 'dist/index.html'), '<title>app</title>');
  writeFileSync(join(dir, 'dist/assets/app.0123456789.js'), 'x');
  writeFileSync(join(dir, 'secret.txt'), 'nope');
  const app = createApp({ port: 0, host: '127.0.0.1', dataDir: join(dir, 'data'), distDir: join(dir, 'dist'), ...opts });
  const port = await app.listen();
  return { app, port };
}

test('this computer controls with no password; a TV only gets the screen page', async () => {
  const { app, port } = await boot();
  try {
    assert.match((await get(port, '/')).body, /<title>app/);
    assert.match((await get(port, '/?screen', { host: `192.168.1.9:${port}` })).body, /<title>app/);
    const denied = await get(port, '/', { host: `192.168.1.9:${port}` });
    assert.match(denied.body, /only available on the computer/);
    assert.equal((await get(port, '/screen')).status, 302);
    assert.equal((await get(port, '/..%2fsecret.txt')).status === 200, false);
    assert.equal((await get(port, '/assets/app.0123456789.js')).headers['cache-control'], 'public,max-age=31536000,immutable');
    assert.equal((await get(port, '/api/setup', { method: 'POST', host: `192.168.1.9:${port}`, body: '{}' })).status, 403);
  } finally { await app.close(); }
});

test('with LAN control on: first visitor sets a password, then logs in', async () => {
  const { app, port } = await boot({ lanControl: true });
  const lan = `192.168.1.9:${port}`, json = { 'content-type': 'application/json' };
  try {
    assert.match((await get(port, '/', { host: lan })).body, /Set a password/);
    const code = app.auth.setupCode;
    assert.match(code, /^[0-9A-F]{8}$/);
    assert.match((await get(port, '/', { host: lan })).body, /Setup code/);
    const setup = (b) => get(port, '/api/setup', { method: 'POST', host: lan, headers: json, body: JSON.stringify(b) });
    assert.equal((await setup({ password: 'long enough pw', code: 'WRONG123' })).status, 403);     // a neighbour cannot claim it
    assert.equal((await setup({ password: 'short', code })).status, 400);
    const set = await setup({ password: 'long enough pw', code: code.toLowerCase() });
    assert.equal(set.status, 200);
    const cookie = set.headers['set-cookie'][0].split(';')[0];
    assert.match((await get(port, '/', { host: lan })).body, /Log in/);
    assert.match((await get(port, '/', { host: lan, headers: { cookie } })).body, /<title>app/);
    assert.equal((await setup({ password: 'another pass', code })).status, 409);
    assert.equal((await get(port, '/api/login', { method: 'POST', host: lan, headers: json, body: JSON.stringify({ password: 'wrong wrong' }) })).status, 401);
    assert.equal((await get(port, '/api/login', { method: 'POST', host: lan, headers: json, body: JSON.stringify({ password: 'long enough pw' }) })).status, 200);
  } finally { await app.close(); }
});

test('end to end over real WebSockets: a screen shows a code, the control page pairs, a mouth arrives', async () => {
  const { app, port } = await boot();
  try {
    const open = (ws) => new Promise((ok) => { ws.onopen = ok; });
    const next = (ws) => new Promise((ok) => { ws.onmessage = (e) => ok(JSON.parse(e.data)); });
    const screen = new WebSocket(`ws://localhost:${port}/ws`), admin = new WebSocket(`ws://localhost:${port}/ws`);
    await Promise.all([open(screen), open(admin)]);
    const codeMsg = next(screen);
    screen.send(JSON.stringify({ action: 'register' }));
    const { code } = await codeMsg;
    const paired = next(admin);
    admin.send(JSON.stringify({ action: 'pair', code }));
    assert.equal((await paired).type, 'paired');
    screen.binaryType = 'arraybuffer';
    const got = new Promise((ok) => { screen.onmessage = (e) => { if (typeof e.data !== 'string') ok(new Uint8Array(e.data)); }; });
    admin.send(mouthBytes(1, [9, 8, 7]));
    assert.deepEqual([...await got], [0x4d, 0, 1, 9, 8, 7]);
    screen.close(); admin.close();
  } finally { await app.close(); }
});

test('a code typed the way the TV shows it (with a space or dash) works', () => {
  const r = new Relay();
  const screen = fakeConn(r, 's', false), admin = fakeConn(r, 'a', true);
  r.handle('s', { action: 'register' });
  const c = screen[0].code;
  r.handle('a', { action: 'pair', code: ` ${c.slice(0, 3).toLowerCase()} - ${c.slice(3)} ` });
  assert.equal(admin.at(-1).type, 'paired');
});

test('wrong guesses are counted per address, so reconnecting does not reset them', () => {
  const r = new Relay();
  for (let i = 0; i < 10; i++) {
    const id = 'c' + i, got = fakeConn(r, id, true);
    r.connect(id, (o) => got.push(o), true, '10.0.0.7');
    r.handle(id, { action: 'pair', code: 'AAAAAA' });
  }
  const last = [];
  r.connect('z', (o) => last.push(o), true, '10.0.0.7');
  r.handle('z', { action: 'pair', code: 'AAAAAA' });
  assert.equal(last.at(-1).error, 'too_many_attempts');
  const other = [];
  r.connect('y', (o) => other.push(o), true, '10.0.0.8');
  r.handle('y', { action: 'pair', code: 'AAAAAA' });
  assert.equal(other.at(-1).error, 'bad_code');
});

test('starting on a taken port fails cleanly', async () => {
  const { app, port } = await boot();
  try {
    const second = createApp({ port, host: '127.0.0.1', dataDir: join(tmpdir(), 'ff-x'), distDir: '.' });
    await assert.rejects(second.listen(), (e) => e.code === 'EADDRINUSE');
    await second.close().catch(() => {});
  } finally { await app.close(); }
});

test('/screen keeps the output options through the redirect and drops everything else', async () => {
  const { app, port } = await boot();
  try {
    assert.equal((await get(port, '/screen')).headers.location, '/?screen');
    assert.equal((await get(port, '/screen?mirror=1&flip=1&awake=0&x=2')).headers.location, '/?screen&mirror=1&flip=1&awake=0');
  } finally { await app.close(); }
});
