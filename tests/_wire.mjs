// Helpers for tests that talk to the server the way a hostile or broken client would: raw bytes on a TCP socket.
import net from 'node:net';

export const mask = (op, payload, { fin = true, rsv = 0 } = {}) => {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload), n = body.length, key = Buffer.from([7, 8, 9, 10]);
  let head;
  if (n < 126) head = Buffer.from([(fin ? 0x80 : 0) | rsv | op, 0x80 | n]);
  else if (n < 65536) head = Buffer.from([(fin ? 0x80 : 0) | rsv | op, 0x80 | 126, n >> 8, n & 255]);
  else { head = Buffer.alloc(10); head[0] = (fin ? 0x80 : 0) | rsv | op; head[1] = 0x80 | 127; head.writeUInt32BE(n, 6); }
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = body[i] ^ key[i & 3];
  return Buffer.concat([head, key, out]);
};
export const textFrame = (obj) => mask(1, typeof obj === 'string' ? obj : JSON.stringify(obj));

export const upgradeRequest = (port, path = '/ws', extra = '') =>
  `GET ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a WebSocket by hand. Server frames are parsed into .frames: {op, text, code}. */
export function openWs(port, { path = '/ws', host } = {}) {
  return new Promise((ok, fail) => {
    const sock = net.connect(port, '127.0.0.1');
    const c = { sock, frames: [], head: '', closed: false, buf: Buffer.alloc(0), status: 0, waiters: [] };
    let upgraded = false;
    sock.on('error', () => {});
    sock.on('close', () => { c.closed = true; c.tick(); });
    sock.on('connect', () => sock.write(upgradeRequest(port, path).replace(`localhost:${port}`, host || `localhost:${port}`)));
    c.tick = () => { c.waiters = c.waiters.filter((w) => !w()); };
    sock.on('data', (d) => {
      c.buf = Buffer.concat([c.buf, d]);
      if (!upgraded) {
        const i = c.buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        c.head = c.buf.subarray(0, i).toString(); c.status = Number(/^HTTP\/1.1 (\d+)/.exec(c.head)[1]);
        c.buf = c.buf.subarray(i + 4); upgraded = true;
        if (c.status !== 101) { sock.destroy(); return ok(c); }
        ok(c);
      }
      while (c.buf.length >= 2) {
        let len = c.buf[1] & 127, at = 2;
        if (len === 126) { if (c.buf.length < 4) break; len = c.buf.readUInt16BE(2); at = 4; }
        else if (len === 127) { if (c.buf.length < 10) break; len = c.buf.readUInt32BE(6); at = 10; }
        if (c.buf.length < at + len) break;
        const op = c.buf[0] & 15, p = c.buf.subarray(at, at + len);
        c.frames.push({ op, text: op === 1 ? p.toString() : '', code: op === 8 && len >= 2 ? p.readUInt16BE(0) : null });
        c.buf = c.buf.subarray(at + len);
      }
      c.tick();
    });
    c.send = (obj) => sock.write(textFrame(obj));
    c.json = () => c.frames.filter((f) => f.op === 1).map((f) => JSON.parse(f.text));
    c.until = (pred, ms = 3000) => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timed out waiting; got ' + JSON.stringify(c.frames.slice(-5)))), ms);
      const w = () => { if (pred(c)) { clearTimeout(t); res(c); return true; } return false; };
      if (!w()) c.waiters.push(w);
    });
    c.untilClosed = (ms) => c.until((x) => x.closed, ms);
    c.closeCode = () => (c.frames.find((f) => f.op === 8) || {}).code;
    setTimeout(() => fail(new Error('no handshake')), 4000).unref();
  });
}

/** One plain HTTP request on a raw socket; resolves with the whole reply text (or '' if the server hung up). */
export function rawHttp(port, text, wait = 300) {
  return new Promise((ok) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let b = '';
    s.on('data', (d) => { b += d; }); s.on('error', () => {});
    s.on('close', () => ok(b));
    setTimeout(() => { s.destroy(); }, wait);
  });
}
