// Mouth frames over real sockets: binary in, the identical bytes out to every screen of the session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { binFrame, mouthBytes, openWs, sleep } from './_wire.mjs';

async function boot(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ff-bin-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist/index.html'), '<title>app</title>');
  const app = createApp({ port: 0, host: '127.0.0.1', dataDir: join(dir, 'data'), distDir: join(dir, 'dist'), onNewCode: () => {}, ...opts });
  return { app, port: await app.listen() };
}
async function addScreen(port, admin) {
  const screen = await openWs(port);
  screen.send({ action: 'register' });
  await screen.until((c) => c.json().some((m) => m.type === 'code'));
  const mine = admin.json().findLast((m) => m.type === 'paired');            // the next screen joins the same session
  admin.send({ action: 'pair', code: screen.json().find((m) => m.type === 'code').code, ...(mine ? { session: mine.session, key: mine.key } : {}) });
  await screen.until((c) => c.json().some((m) => m.type === 'paired'));
  await admin.until((c) => c.json().filter((m) => m.type === 'paired').length > (mine ? 1 : 0));
  return screen;
}
async function pairUp(port, screens = 1) {
  const admin = await openWs(port), list = [];
  for (let i = 0; i < screens; i++) list.push(await addScreen(port, admin));
  return { admin, screens: list };
}
const eq = (a, b) => assert.deepEqual([...a], [...b]);

test('a valid mouth frame reaches the screen byte for byte, as a binary frame', async () => {
  const { app, port } = await boot();
  try {
    const { admin, screens: [s] } = await pairUp(port);
    const one = mouthBytes(7, [200, 100, 50]);
    admin.sendBytes(one);
    await s.until((c) => c.binary().length === 1);
    eq(s.binary()[0], one);
    assert.equal(s.frames.at(-1).op, 2);
    const eight = mouthBytes(0xfffe, Array.from({ length: 24 }, (_, i) => i * 10));
    admin.sendBytes(eight);
    await s.until((c) => c.binary().length === 2);
    eq(s.binary()[1], eight);
  } finally { await app.close(); }
});

test('every screen of the session gets the same frame; another session gets nothing', async () => {
  const { app, port } = await boot();
  try {
    const { admin, screens } = await pairUp(port, 3);
    const other = await pairUp(port, 1);
    const f = mouthBytes(1, [9, 8, 7, 6, 5, 4]);
    admin.sendBytes(f);
    for (const s of screens) { await s.until((c) => c.binary().length === 1); eq(s.binary()[0], f); }
    await sleep(100);
    assert.equal(other.screens[0].binary().length, 0);
  } finally { await app.close(); }
});

test('frames of the wrong length, wrong type byte or nine pumpkins are dropped, and the connection lives on', async () => {
  const { app, port } = await boot();
  try {
    const { admin, screens: [s] } = await pairUp(port);
    admin.sendBytes(mouthBytes(1, [1, 2]));                                 // 5 bytes
    admin.sendBytes(mouthBytes(1, []));                                     // 3 bytes: no pumpkin
    admin.sendBytes(Buffer.from([0x4d]));
    admin.sendBytes(Buffer.from([0x4e, 0, 1, 1, 2, 3]));                    // wrong type byte
    admin.sendBytes(Buffer.from([0x00, 0, 1, 1, 2, 3]));
    admin.sendBytes(mouthBytes(1, new Array(27).fill(1)));                  // nine pumpkins: 30 bytes
    const good = mouthBytes(2, [3, 3, 3]);
    admin.sendBytes(good);
    await s.until((c) => c.binary().length >= 1);
    await sleep(100);
    assert.equal(s.binary().length, 1);
    eq(s.binary()[0], good);
    assert.equal(admin.closed, false);
  } finally { await app.close(); }
});

test('an oversize binary message closes the sender with 1009 and reaches nobody', async () => {
  const { app, port } = await boot();
  try {
    const { admin, screens: [s] } = await pairUp(port);
    admin.sock.write(binFrame(Buffer.alloc(100, 0x4d)));
    await admin.untilClosed(2000);
    assert.equal(admin.closeCode(), 1009);
    assert.equal(s.binary().length, 0);
  } finally { await app.close(); }
});

test('a connection that is not the control page cannot send mouths', async () => {
  const { app, port } = await boot();
  try {
    const { screens: [s] } = await pairUp(port);
    s.sendBytes(mouthBytes(1, [1, 2, 3]));                                  // a screen has no say
    await sleep(100);
    const lan = await openWs(port, { host: 'guest.example:1' });              // a LAN guest: not trusted to control
    lan.sendBytes(mouthBytes(1, [1, 2, 3]));
    await lan.until((c) => c.json().some((m) => m.error === 'not_admin'));
    await sleep(100);
    assert.equal(s.binary().length, 0);
  } finally { await app.close(); }
});

test('a control page with no screens is told so, and nothing is queued', async () => {
  const { app, port } = await boot();
  try {
    const { admin, screens: [s] } = await pairUp(port);
    s.sock.destroy();
    await admin.until((c) => c.json().some((m) => m.type === 'screens' && m.n === 0));
    const before = admin.json().length;
    admin.sendBytes(mouthBytes(1, [1, 2, 3]));
    await admin.until((c) => c.json().length > before);
    assert.deepEqual(admin.json().at(-1), { type: 'screens', n: 0 });
  } finally { await app.close(); }
});

test('a stalled screen is skipped, the others and the sender are unaffected', async () => {
  const { app, port } = await boot({ rate: 1e9, burst: 1e9 });
  try {
    const { admin, screens: [slow, fast] } = await pairUp(port, 2);
    slow.sock.pause();
    const f = mouthBytes(1, [1, 2, 3]);
    for (let round = 0; round < 40; round++) { admin.sock.write(Buffer.concat(Array(5000).fill(binFrame(f)))); await sleep(5); }
    await sleep(500);
    assert.ok(app.stats().maxQueued < 64 * 1024, `queued ${app.stats().maxQueued} bytes`);
    assert.ok(fast.binary().length > 1000, 'the healthy screen kept receiving');
    assert.equal(admin.closed, false);
    assert.equal(slow.closed, false);
  } finally { await app.close(); }
});

test('binary frames count toward the rate limit', async () => {
  const { app, port } = await boot();
  try {
    const { admin } = await pairUp(port);
    admin.sock.write(Buffer.concat(Array.from({ length: 2000 }, () => binFrame(mouthBytes(1, [1, 2, 3])))));
    await admin.untilClosed(2000);
    assert.equal(admin.closeCode(), 1008);
  } finally { await app.close(); }
});

test('the old JSON mouth message is gone: it is not forwarded', async () => {
  const { app, port } = await boot();
  try {
    const { admin, screens: [s] } = await pairUp(port);
    admin.send({ action: 'm', v: [1, 2, 3], n: 1 });
    await sleep(100);
    assert.equal(s.frames.filter((f) => f.op === 1 && /"m"/.test(f.text)).length, 0);
    assert.equal(s.binary().length, 0);
  } finally { await app.close(); }
});
