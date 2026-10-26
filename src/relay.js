// The connection to the relay (a WebSocket). It reconnects by itself, and keeps the line from timing out.
const PING_MS = 4 * 60 * 1000;

export async function loadConfig(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn('config.json', { cache: 'no-store' });
    const c = r.ok ? await r.json() : null;
    return c && typeof c.relay === 'string' && /^wss:\/\//.test(c.relay) ? c : null;
  } catch { return null; }
}

export class Link {
  constructor(url, on) {
    this.url = url; this.on = on; this.ws = null; this.delay = 1000; this.stopped = true; this.pinger = 0; this.retry = 0;
  }

  start() { this.stopped = false; this._connect(); }
  stop() { this.stopped = true; clearInterval(this.pinger); clearTimeout(this.retry); if (this.ws) this.ws.close(); }
  get open() { return !!this.ws && this.ws.readyState === 1; }

  send(obj) {
    if (!this.open) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  _connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.delay = 1000;
      this.pinger = setInterval(() => this.send({ action: 'ping' }), PING_MS);
      if (this.on.open) this.on.open();
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && typeof msg === 'object' && this.on.message) this.on.message(msg);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      if (this.on.close) this.on.close();
      if (this.stopped) return;
      this.retry = setTimeout(() => this._connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 15000);
    };
  }
}
