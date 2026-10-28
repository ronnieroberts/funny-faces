// The connection to the relay (a WebSocket). It reconnects by itself, and keeps the line from timing out.
const PING_MS = 4 * 60 * 1000;

/** The relay is the server that served this page: ws(s)://<same host>/ws. Null when the page is not served by Funny Faces
 *  (a file opened from disk, say), so the Screens tab says so instead of failing. */
export async function loadConfig(fetchFn = globalThis.fetch, loc = globalThis.location) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return null;
  try {
    const r = await fetchFn('/api/info', { cache: 'no-store' });
    if (!r.ok) return null;
    const info = await r.json();
    return { relay: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`, info };
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
