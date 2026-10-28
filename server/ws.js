// A small WebSocket server side (RFC 6455): text messages (JSON) and small binary messages (mouth frames).
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// A single unfragmented frame may be up to MAX_FRAME bytes: that is only needed for the occasional "state" message
// (the whole look of the faces, kept under 200,000 bytes by relay.js). Anything fragmented is a stranger's
// doing (browsers send these messages in one frame), so fragmented messages are held to the much smaller
// MAX_FRAGMENTED, in at most MAX_FRAGMENTS pieces.
export const LIMITS = {
  MAX_FRAME: 250000, MAX_FRAGMENTED: 64 * 1024, MAX_FRAGMENTS: 64,
  MAX_BINARY: 64,                   // the only binary message is a mouth frame, 27 bytes at most: anything bigger is a stranger's
  MAX_BUFFERED: 1024 * 1024,        // a socket with this much unsent data is stalled: drop it
  MAX_BUFFERED_DISPOSABLE: 16 * 1024,   // mouth frames are skipped for a screen that is this far behind
};
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const VALID_CLOSE = (c) => (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1011) || (c >= 3000 && c <= 4999);

export class Socket extends EventEmitter {
  constructor(socket, limits = {}) {
    super();
    this.limits = { ...LIMITS, ...limits };
    this.socket = socket; this.buf = Buffer.alloc(0); this.parts = []; this.partBytes = 0; this.kind = 0; this.closed = false;
    this.alive = true; this.timers = [];
    socket.on('data', (d) => { this.alive = true; this._data(d); });
    socket.on('end', () => this._finish(true));               // the HTTP server keeps sockets half open: a peer that left sends no 'close'
    socket.on('close', () => this._finish(true));
    socket.on('error', () => this._finish(true));
  }

  /** Send a message: a string goes out as text, a Buffer as binary. With disposable, it is skipped (returns false) when this socket is already behind. */
  send(data, disposable = false) {
    if (this.closed) throw new Error('closed');
    const queued = this.socket.writableLength || 0;
    if (queued > this.limits.MAX_BUFFERED) { this.terminate(); throw new Error('closed'); }   // stalled: do not hoard memory
    if (disposable && queued > this.limits.MAX_BUFFERED_DISPOSABLE) return false;
    const body = typeof data === 'string' ? Buffer.from(data) : data, n = body.length, op = typeof data === 'string' ? 0x81 : 0x82;
    let head;
    if (n < 126) head = Buffer.from([op, n]);
    else if (n < 65536) head = Buffer.from([op, 126, n >> 8, n & 255]);
    else { head = Buffer.alloc(10); head[0] = op; head[1] = 127; head.writeUInt32BE(n, 6); }
    this.socket.write(Buffer.concat([head, body]));
    return true;
  }

  /** Server keepalive: ping every pingMs; if nothing at all arrives within pongMs of a ping, the peer is dead. */
  keepAlive(pingMs = 30000, pongMs = 10000) {
    const t = setInterval(() => {
      if (this.closed) return;
      this.alive = false;
      try { this.socket.write(Buffer.from([0x89, 0])); } catch { /* closing */ }
      const d = setTimeout(() => { if (!this.alive) this.terminate(); }, pongMs);
      d.unref(); this.timers.push(d);
    }, pingMs);
    t.unref(); this.timers.push(t);
  }

  /** Close politely: a close frame with a status code, flushed before the socket ends. */
  close(code = 1000) {
    if (this.closed) return;
    const frame = Buffer.from([0x88, 2, code >> 8, code & 255]);
    try { this.socket.end(frame); } catch { /* gone */ }
    this._finish(false);
    const t = setTimeout(() => this.socket.destroy(), 1000);   // a peer that never finishes the close does not keep us
    t.unref();
  }

  /** Drop without ceremony (dead or stalled peer). */
  terminate() { this._finish(true); }

  _finish(destroy) {
    if (!this.closed) {
      this.closed = true;
      for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
      this.parts = []; this.buf = Buffer.alloc(0);
      this.emit('close');
    }
    if (destroy) this.socket.destroy();
  }

  _data(d) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    const L = this.limits;
    while (!this.closed) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 15, masked = !!(b[1] & 0x80);
      if (b[0] & 0x70) return this.close(1002);                         // reserved bits: no extensions were negotiated
      if (!(op <= 2 || (op >= 8 && op <= 10))) return this.close(1002); // unknown opcode
      let len = b[1] & 127, at = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (b.length < 10) return; if (b.readUInt32BE(2) !== 0) return this.close(1009); len = b.readUInt32BE(6); at = 10; }
      if (!masked) return this.close(1002);                              // browsers always mask
      if (op >= 8) { if (len > 125 || !fin) return this.close(1002); }   // control frames: short and never fragmented
      else {
        if (op === 0 && !this.parts.length) return this.close(1002);     // continuation of nothing
        if (op !== 0 && this.parts.length) return this.close(1002);      // new message in the middle of one
        if (len > L.MAX_FRAME) return this.close(1009);
        if ((op === 2 || (op === 0 && this.kind === 2)) && this.partBytes + len > L.MAX_BINARY) return this.close(1009);
        if (!fin || this.parts.length) {                                 // fragmented: strict limits, counted as we go
          if (this.parts.length >= L.MAX_FRAGMENTS || this.partBytes + len > L.MAX_FRAGMENTED) return this.close(1009);
        }
      }
      if (b.length < at + 4 + len) return;
      const mask = b.subarray(at, at + 4), out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = b[at + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(at + 4 + len);
      if (op === 8) {
        if (len === 1) return this.close(1002);
        if (len >= 2) {
          const code = out.readUInt16BE(0);
          if (!VALID_CLOSE(code)) return this.close(1002);
          try { decoder.decode(out.subarray(2)); } catch { return this.close(1007); }
        }
        return this.close(1000);
      }
      if (op === 9) { this.socket.write(Buffer.concat([Buffer.from([0x8a, len]), out])); continue; }
      if (op === 10) continue;
      if (op !== 0) this.kind = op;
      this.parts.push(out); this.partBytes += len;
      if (fin) {
        const all = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts), binary = this.kind === 2;
        this.parts = []; this.partBytes = 0;
        let msg = all;                                                   // binary: the Buffer as it came; text: a string
        if (!binary) { try { msg = decoder.decode(all); } catch { return this.close(1007); } }
        this.emit('message', msg);
      }
    }
  }
}

/** Finish the handshake for an 'upgrade' request. Returns a Socket, or null (the socket is dropped). */
export function upgrade(req, socket, limits) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new Socket(socket, limits);
}
