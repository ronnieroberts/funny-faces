// The hand-written WebSocket layer, driven with a fake socket (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Socket, upgrade } from '../server/ws.js';
import { mask } from './_wire.mjs';

class FakeSocket extends EventEmitter {
  constructor() { super(); this.written = []; this.ended = false; this.destroyed = false; this.writableLength = 0; }
  write(buf) { this.written.push(Buffer.from(buf)); return true; }
  end(buf) { if (buf) this.written.push(Buffer.from(buf)); this.ended = true; }   // like net.Socket: no 'close' yet
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
}
function setup(limits) {
  const socket = new FakeSocket(), ws = new Socket(socket, limits), got = { messages: [], closes: 0 };
  ws.on('message', (m) => got.messages.push(m));
  ws.on('close', () => { got.closes++; });
  return { socket, ws, got, feed: (...bufs) => bufs.forEach((b) => socket.emit('data', b)) };
}
const closeFrames = (socket) => socket.written.filter((b) => b[0] === 0x88);
const closeCode = (socket) => { const f = closeFrames(socket)[0]; return f && f.length >= 4 ? f.readUInt16BE(2) : null; };

test('short, 16-bit and 64-bit-header masked text frames each emit one message', () => {
  const { feed, got } = setup();
  feed(mask(1, 'hello'), mask(1, 'x'.repeat(126)), mask(1, 'y'.repeat(70000)));
  assert.deepEqual(got.messages.map((m) => m.length), [5, 126, 70000]);
});

test('a frame split across data events, and two frames in one event', () => {
  const { feed, got } = setup();
  const f = mask(1, 'hello');
  feed(f.subarray(0, 3), f.subarray(3));
  feed(Buffer.concat([mask(1, 'a'), mask(1, 'b')]));
  assert.deepEqual(got.messages, ['hello', 'a', 'b']);
});

test('a fragmented message is joined; multibyte text split between fragments is fine', () => {
  const { feed, got } = setup();
  const euro = Buffer.from('€');                                        // 3 bytes
  feed(mask(1, 'hel', { fin: false }), mask(0, 'lo', { fin: true }));
  feed(mask(1, euro.subarray(0, 1), { fin: false }), mask(0, euro.subarray(1), { fin: true }));
  assert.deepEqual(got.messages, ['hello', '€']);
});

test('an unmasked frame closes with 1002 and a real close frame', () => {
  const { socket, feed, got } = setup();
  feed(Buffer.from([0x81, 0x01, 0x41]));
  assert.equal(closeCode(socket), 1002);
  assert.equal(got.closes, 1);
});

test('the single-frame limit is 250,000 bytes; one more closes with 1009', () => {
  const a = setup(); a.feed(mask(1, 'x'.repeat(250000)));
  assert.equal(a.got.messages.length, 1);
  const b = setup(); b.feed(mask(1, 'x'.repeat(250001)));
  assert.equal(closeCode(b.socket), 1009);
});

test('a 64-bit length with high bits set closes with 1009, without waiting for data', () => {
  const { socket, feed } = setup();
  const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeUInt32BE(1, 2);
  feed(h);
  assert.equal(closeCode(socket), 1009);
});

test('M1: more than 64 fragments is refused', () => {
  const ok = setup();
  ok.feed(mask(1, 'a', { fin: false }));
  for (let i = 0; i < 62; i++) ok.feed(mask(0, 'a', { fin: false }));
  ok.feed(mask(0, 'a', { fin: true }));                                   // 64 fragments in all
  assert.equal(ok.got.messages[0].length, 64);
  const bad = setup();
  bad.feed(mask(1, 'a', { fin: false }));
  for (let i = 0; i < 64; i++) bad.feed(mask(0, 'a', { fin: false }));
  assert.equal(closeCode(bad.socket), 1009);
  assert.equal(bad.got.messages.length, 0);
});

test('M1: a fragmented message over 64 KB is refused, but one 64 KB frame is fine', () => {
  const a = setup();
  a.feed(mask(1, 'x'.repeat(40000), { fin: false }), mask(0, 'x'.repeat(30000), { fin: true }));
  assert.equal(closeCode(a.socket), 1009);
  const b = setup(); b.feed(mask(1, 'x'.repeat(100000)));                // unfragmented may be larger: it is a state message
  assert.equal(b.got.messages.length, 1);
});

test('M1: 100,000 one-byte continuation frames in one packet are rejected fast (was ~6 s of blocked event loop)', () => {
  const { socket, feed, got } = setup();
  const one = [mask(1, 'a', { fin: false })];
  for (let i = 0; i < 99999; i++) one.push(mask(0, 'a', { fin: false }));
  const big = Buffer.concat(one), t = process.hrtime.bigint();
  feed(big);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.equal(closeCode(socket), 1009);
  assert.equal(got.messages.length, 0);
  assert.ok(ms < 500, `took ${ms} ms`);
});

test('control frames: at most 125 bytes, never fragmented', () => {
  const a = setup(); a.feed(mask(9, 'p'.repeat(125)));
  assert.equal(a.socket.written.filter((b) => b[0] === 0x8a).length, 1);
  assert.equal(a.socket.written.find((b) => b[0] === 0x8a).length, 127);   // pong echoes the payload
  const b = setup(); b.feed(mask(9, 'p'.repeat(126)));
  assert.equal(closeCode(b.socket), 1002);
  const c = setup(); c.feed(mask(9, 'p', { fin: false }));
  assert.equal(closeCode(c.socket), 1002);
  const d = setup(); d.feed(mask(8, Buffer.alloc(126)));
  assert.equal(closeCode(d.socket), 1002);
});

test('reserved bits and unknown opcodes close with 1002', () => {
  for (const rsv of [0x40, 0x20, 0x10]) { const t = setup(); t.feed(mask(1, 'x', { rsv })); assert.equal(closeCode(t.socket), 1002, `rsv ${rsv}`); }
  for (const op of [3, 4, 5, 6, 7, 11, 12, 13, 14, 15]) { const t = setup(); t.feed(mask(op, 'x')); assert.equal(closeCode(t.socket), 1002, `op ${op}`); }
});

test('continuation with nothing to continue, or a new message in the middle of one, closes with 1002', () => {
  const a = setup(); a.feed(mask(0, 'x')); assert.equal(closeCode(a.socket), 1002);
  const b = setup(); b.feed(mask(1, 'x', { fin: false }), mask(1, 'y')); assert.equal(closeCode(b.socket), 1002);
});

test('invalid UTF-8 in a text message closes with 1007 and is not delivered', () => {
  const a = setup(); a.feed(mask(1, Buffer.from([0xff, 0xfe, 0x41])));
  assert.equal(closeCode(a.socket), 1007); assert.equal(a.got.messages.length, 0);
  const b = setup(); b.feed(mask(1, Buffer.from([0xe2, 0x82])));          // truncated euro sign
  assert.equal(closeCode(b.socket), 1007);
});

test('a binary message arrives as a Buffer, whole, even when it is not valid UTF-8', () => {
  const { feed, got, socket } = setup();
  feed(mask(2, Buffer.from([0x4d, 0xff, 0xfe, 1, 2, 3])), mask(2, Buffer.from([1, 2]), { fin: false }), mask(0, Buffer.from([0xff]), { fin: true }));
  assert.deepEqual(got.messages.map((m) => [...m]), [[0x4d, 0xff, 0xfe, 1, 2, 3], [1, 2, 0xff]]);
  assert.ok(Buffer.isBuffer(got.messages[0]));
  assert.equal(closeCode(socket), null);
});

test('a binary message over the small binary cap closes with 1009, also when it is fragmented', () => {
  const a = setup(); a.feed(mask(2, Buffer.alloc(65)));
  assert.equal(closeCode(a.socket), 1009); assert.equal(a.got.messages.length, 0);
  const b = setup(); b.feed(mask(2, Buffer.alloc(40), { fin: false }), mask(0, Buffer.alloc(40), { fin: true }));
  assert.equal(closeCode(b.socket), 1009);
  const c = setup(); c.feed(mask(2, Buffer.alloc(64)));
  assert.equal(closeCode(c.socket), null); assert.equal(c.got.messages.length, 1);
});

test('a text frame cannot be continued as binary or the other way round', () => {
  const a = setup(); a.feed(mask(1, 'x', { fin: false }), mask(2, 'y'));
  assert.equal(closeCode(a.socket), 1002);
});

test('send: a Buffer goes out as an unmasked binary frame', () => {
  const { ws, socket } = setup();
  ws.send(Buffer.from([0x4d, 0, 1, 9, 8, 7]));
  assert.deepEqual([...socket.written[0]], [0x82, 6, 0x4d, 0, 1, 9, 8, 7]);
});

test('ping is answered with pong and is not a message; an unsolicited pong is ignored', () => {
  const { socket, feed, got } = setup();
  feed(mask(9, 'hi'), mask(10, ''));
  assert.deepEqual(socket.written.map((b) => b[0]), [0x8a]);
  assert.equal(got.messages.length, 0);
});

test('a close frame from the peer is answered with a close frame, flushed with end(), and close is emitted once', () => {
  const { socket, feed, got } = setup();
  feed(mask(8, Buffer.from([0x03, 0xe8])));
  assert.equal(closeCode(socket), 1000);
  assert.equal(socket.ended, true);
  assert.equal(socket.destroyed, false, 'must not destroy before the close frame is flushed');
  feed(mask(8, Buffer.from([0x03, 0xe8])));
  assert.equal(got.closes, 1);
});

test('bad close payloads: one byte, an invalid status code, a non UTF-8 reason', () => {
  for (const [p, code] of [[[0x03], 1002], [[0x03, 0xed], 1002], [[0x03, 0xe8, 0xff], 1007]]) {
    const t = setup(); t.feed(mask(8, Buffer.from(p))); assert.equal(closeCode(t.socket), code, JSON.stringify(p));
  }
});

test('close(): the close frame goes out through end() and the socket is not destroyed under it', () => {
  const { socket, ws, got } = setup();
  ws.close(1001);
  assert.equal(closeCode(socket), 1001);
  assert.equal(socket.ended, true);
  assert.equal(socket.destroyed, false);
  assert.equal(got.closes, 1);
  socket.emit('close');
  assert.equal(got.closes, 1);
});

test('send: frame headers, 64-bit headers, and an error after close', () => {
  const { socket, ws } = setup();
  ws.send('hello');
  assert.deepEqual([...socket.written[0].subarray(0, 2)], [0x81, 5]);
  ws.send('x'.repeat(65536));
  assert.deepEqual([...socket.written[1].subarray(0, 2)], [0x81, 127]);
  assert.equal(socket.written[1].readUInt32BE(6), 65536);
  ws.close();
  assert.throws(() => ws.send('late'), /closed/);
});

test('M3: a socket with over 1 MB unsent is dropped; mouth (disposable) messages are skipped for a socket that is behind', () => {
  const a = setup();
  a.socket.writableLength = 20 * 1024;
  assert.equal(a.ws.send('mouth', true), false);                        // skipped, nothing written
  assert.equal(a.socket.written.length, 0);
  assert.equal(a.ws.send('state', false), true);                        // an important message still goes out
  assert.equal(a.got.closes, 0);
  a.socket.writableLength = 1024 * 1024 + 1;
  assert.throws(() => a.ws.send('state'), /closed/);
  assert.equal(a.socket.destroyed, true);
  assert.equal(a.got.closes, 1);
});

test('M2: keepAlive pings, and drops a peer that never answers', async () => {
  const { socket, ws, got } = setup();
  ws.keepAlive(20, 20);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(socket.written.some((b) => b[0] === 0x89), 'a ping was sent');
  assert.equal(got.closes, 1);
  assert.equal(socket.destroyed, true);
});

test('M2: keepAlive keeps a peer that answers (any frame counts)', async () => {
  const { socket, ws, got, feed } = setup();
  ws.keepAlive(20, 20);
  for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 15)); feed(mask(10, '')); }
  assert.equal(got.closes, 0);
  ws.close();
});

test('the peer going away (end without close) is noticed: the HTTP server keeps sockets half open', () => {
  const { socket, got } = setup();
  socket.emit('end');
  assert.equal(got.closes, 1);
  assert.equal(socket.destroyed, true);
});

test('upgrade: correct Sec-WebSocket-Accept (RFC 6455 example)', () => {
  const socket = new FakeSocket();
  const ws = upgrade({ headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', upgrade: 'WebSocket' } }, socket);
  assert.ok(ws);
  assert.match(String(socket.written[0]), /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);
});

test('upgrade refuses a missing key or a missing Upgrade header', () => {
  for (const headers of [{ upgrade: 'websocket' }, { 'sec-websocket-key': 'abc' }]) {
    const socket = new FakeSocket();
    assert.equal(upgrade({ headers }, socket), null);
    assert.equal(socket.written.length, 0);
    assert.equal(socket.destroyed, true);
  }
});
