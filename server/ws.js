// A small WebSocket server side (RFC 6455): text messages only, which is all the page sends.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 250000;

export class Socket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket; this.buf = Buffer.alloc(0); this.parts = []; this.closed = false;
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._end());
    socket.on('error', () => this._end());
  }

  send(text) {
    if (this.closed) throw new Error('closed');
    const body = Buffer.from(text), n = body.length;
    let head;
    if (n < 126) head = Buffer.from([0x81, n]);
    else if (n < 65536) head = Buffer.from([0x81, 126, n >> 8, n & 255]);
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeUInt32BE(n, 6); }
    this.socket.write(Buffer.concat([head, body]));
  }

  close() { if (!this.closed) { try { this.socket.end(Buffer.from([0x88, 0])); } catch { /* gone */ } this._end(); } }
  _end() { if (!this.closed) { this.closed = true; this.emit('close'); this.socket.destroy(); } }

  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 15, masked = !!(b[1] & 0x80);
      let len = b[1] & 127, at = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (b.length < 10) return; if (b.readUInt32BE(2) !== 0) return this.close(); len = b.readUInt32BE(6); at = 10; }
      if (!masked || len > MAX) return this.close();                   // browsers always mask
      if (b.length < at + 4 + len) return;
      const mask = b.subarray(at, at + 4), out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = b[at + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(at + 4 + len);
      if (op === 8) return this.close();
      if (op === 9) { this.socket.write(Buffer.concat([Buffer.from([0x8a, len]), out.subarray(0, 125)])); continue; }
      if (op === 1 || op === 0) {
        this.parts.push(out);
        if (this.parts.reduce((n, p) => n + p.length, 0) > MAX) return this.close();
        if (fin) { const text = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.emit('message', text); }
      }
    }
  }
}

/** Finish the handshake for an 'upgrade' request. Returns a Socket. */
export function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new Socket(socket);
}
