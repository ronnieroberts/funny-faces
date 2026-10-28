// Funny Faces server: serves the page, relays mouth data to paired screens, and decides who may control.
// No dependencies. Control from this computer needs no password; a TV opens /?screen and pairs with a code.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Auth, isLocal, sameOrigin } from './auth.js';
import { Relay } from './relay.js';
import { upgrade } from './ws.js';
import { listPacks, readPack } from './packs.js';

const bareIp = (a) => String(a || '').replace(/^::ffff:/, '');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style nonce="NONCE">body{font:18px system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:26rem;padding:2rem}input,button{font:inherit;padding:.6rem;margin:.3rem 0;width:100%;box-sizing:border-box;border-radius:8px;border:1px solid #444;background:#222;color:#eee}
button{background:#e8741a;border:0;color:#111;font-weight:600}small{color:#aaa}</style><main>${body}</main>`;

const form = (title, intro, extra) => page(title, `<h1>${title}</h1><p>${intro}</p>
<form id="f">${extra.code ? '<input id="code" placeholder="Setup code from the terminal window" autocomplete="off" required>' : ''}<input id="pw" type="password" autocomplete="${extra.auto}" placeholder="Password" minlength="8" required autofocus>
<button>${extra.button}</button><small id="m"></small></form>
<script nonce="NONCE">f.onsubmit=async e=>{e.preventDefault();const r=await fetch('${extra.api}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw.value,code:window.code?code.value:''})});
if(r.ok)location.href='/';else m.textContent=(await r.json().catch(()=>({}))).error||'Try again'}</script>`);

// The page loads only its own scripts, one inline-style attribute set, a blob worker (a steady timer), data/blob images and a
// WebSocket to this same host. Nothing else is allowed, and nothing may frame it.
const appCsp = (host) => `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src blob:; connect-src 'self'${host ? ` ws://${host} wss://${host}` : ''}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
const pageCsp = (nonce) => `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
const safeHost = (req) => (/^[\w.\-]+(:\d+)?$|^\[[0-9a-f:.]+\](:\d+)?$/i.test(String(req.headers.host || '')) ? req.headers.host : '');

/** LAN addresses a TV can use to reach this computer, nicest first. */
export function lanUrls(port) {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b)).map((ip) => `http://${ip}:${port}`);
}

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function createApp({ port = 8765, host = '0.0.0.0', dataDir = './data', distDir = './dist', packsDir = './packs', lanControl = false,
  maxConnections = 256, maxPerIp = 20, pingMs = 30000, pongMs = 10000, idleMs = 60000, rate = 100, burst = 200, onNewCode } = {}) {
  const auth = new Auth(dataDir, { lanControl, ...(onNewCode ? { onNewCode } : {}) });
  auth.needSetupCode();
  const sessFile = join(dataDir, 'sessions.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(sessFile, 'utf8')); } catch { /* first run */ }
  let saveTimer = null, latest = null;
  const writeSessions = () => {
    clearTimeout(saveTimer); saveTimer = null;
    if (!latest) return;
    const clean = Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, { key: v.key, state: v.state, ttl: v.ttl }]));
    latest = null;
    try {                                                                // private to this user, and never half written
      writeFileSync(sessFile + '.tmp', JSON.stringify(clean), { mode: 0o600 });
      renameSync(sessFile + '.tmp', sessFile);
    } catch { /* read-only disk: sessions just will not survive a restart */ }
  };
  const relay = new Relay({ sessions: saved, onSessions: (s) => {
    latest = s;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeSessions, 500);
  } });
  const sweep = setInterval(() => { relay.sweep(); auth.sweep(); }, 60000);
  sweep.unref();

  const json = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((ok) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 4096) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(b)); } catch { ok({}); } });
  });
  const ip = (req) => req.socket.remoteAddress || '';

  const parse = (u) => { try { return new URL(u, 'http://x'); } catch { return null; } };
  const html = (res, req, code, body, nonce) => {
    res.writeHead(code, { 'content-type': TYPES['.html'], 'cache-control': 'no-store', 'x-frame-options': 'DENY',
      'content-security-policy': nonce ? pageCsp(nonce) : appCsp(safeHost(req)) });
    res.end(body);
  };
  const small = (res, req, body) => { const nonce = randomBytes(16).toString('base64'); html(res, req, 200, body.replaceAll('NONCE', nonce), nonce); };

  async function onRequest(req, res) {
    const url = parse(req.url);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    if (!url) { res.writeHead(400); return res.end('Bad request'); }
    const path = url.pathname;

    if (path === '/api/info') {
      return json(res, 200, { urls: lanUrls(server.address().port), local: isLocal(req), lanControl, mayControl: auth.mayControl(req) });
    }
    if (path === '/api/packs' || path.startsWith('/api/packs/')) {   // read-only, and only for whoever may control
      if (req.method !== 'GET' || !auth.mayControl(req) || (req.headers.origin && !sameOrigin(req))) return json(res, 403, { error: 'Not allowed' });
      if (path === '/api/packs') return json(res, 200, listPacks(packsDir));
      let name;
      try { name = decodeURIComponent(path.slice('/api/packs/'.length)); } catch { name = ''; }
      const text = readPack(packsDir, name);
      if (!text) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); return res.end(text);
    }
    if (req.method === 'POST' && (path === '/api/setup' || path === '/api/login')) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Not allowed' });
      const { password, code } = await readBody(req);
      if (!lanControl) return json(res, 403, { error: 'Control from other devices is turned off' });
      const wait = (secs) => json(res, 429, { error: `Too many wrong tries. Wait ${secs > 90 ? Math.ceil(secs / 60) + ' minutes' : secs + ' seconds'} and try again.` }, { 'retry-after': String(secs) });
      if (path === '/api/setup') {
        if (auth.hasPassword) return json(res, 409, { error: 'A password is already set' });
        if (auth.setupLockedFor(ip(req))) return wait(auth.setupLockedFor(ip(req)));
        if (!auth.checkSetupCode(code, ip(req))) return auth.setupLockedFor(ip(req)) ? wait(auth.setupLockedFor(ip(req))) : json(res, 403, { error: 'Wrong setup code. It is shown in the window where Funny Faces is running.' });
        try { auth.setPassword(password); } catch (e) { return json(res, 400, { error: e.message }); }
        return json(res, 200, { ok: true }, { 'set-cookie': auth.cookie(auth.token()) });
      }
      if (auth.lockedFor(ip(req))) return wait(auth.lockedFor(ip(req)));
      if (!auth.checkPassword(password, ip(req))) return auth.lockedFor(ip(req)) ? wait(auth.lockedFor(ip(req))) : json(res, 401, { error: 'Wrong password' });
      return json(res, 200, { ok: true }, { 'set-cookie': auth.cookie(auth.token()) });
    }
    if (path === '/screen') {                          // keep the output options (?mirror=1&flip=1&awake=0) through the redirect
      const q = new URLSearchParams({ screen: '' });
      for (const k of ['mirror', 'flip', 'awake']) if (url.searchParams.has(k)) q.set(k, url.searchParams.get(k).slice(0, 5));
      res.writeHead(302, { location: '/?' + q.toString().replace('screen=', 'screen') }); return res.end();
    }

    // The control page. A screen (?screen) is only the page: it can do nothing without a code.
    if ((path === '/' || path === '/index.html') && !url.searchParams.has('screen') && !auth.mayControl(req)) {
      if (!lanControl) return small(res, req, page('Funny Faces', '<h1>Funny Faces</h1><p>Controls are only available on the computer that runs Funny Faces.</p><p>On a TV or another screen, open <b>/screen</b> instead and type the code it shows into the control page.</p>'));
      return small(res, req, auth.hasPassword
        ? form('Log in', 'Enter the Funny Faces password.', { api: '/api/login', button: 'Log in', auto: 'current-password' })
        : form('Set a password', 'First time here. Choose a password for controlling Funny Faces from other devices (8 or more characters).', { api: '/api/setup', button: 'Save password', auto: 'new-password', code: true }));
    }

    // static files
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { res.writeHead(400); return res.end('Bad request'); }
    const rel = normalize(decoded).replace(/^([/\\])+/, '') || 'index.html';
    let file = join(distDir, rel);
    if (!file.startsWith(join(distDir) + sep) && file !== join(distDir)) { res.writeHead(403); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    const hashed = /\.[0-9a-f]{10}\.js$/.test(file), type = TYPES[extname(file)] || 'application/octet-stream';
    const stream = createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('Error'); } else res.destroy(); });
    stream.on('open', () => {
      res.writeHead(200, { 'content-type': type, 'cache-control': hashed ? 'public,max-age=31536000,immutable' : 'no-cache',
        ...(type === TYPES['.html'] ? { 'x-frame-options': 'DENY', 'content-security-policy': appCsp(safeHost(req)) } : {}) });
      stream.pipe(res);
    });
  }

  const server = createServer((req, res) => { onRequest(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* gone */ } }); });
  server.maxConnections = maxConnections;
  server.on('connection', (socket) => { socket.on('error', () => {}); socket.setKeepAlive(true, 30000); });   // a bad peer must never throw here
  const perIp = new Map(), sockets = new Set();
  const refuse = (socket, line) => { try { socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); } };

  server.on('upgrade', (req, socket) => {
    socket.on('error', () => {});
    try {
      const url = parse(req.url);
      if (!url || url.pathname !== '/ws') return socket.destroy();
      const from = bareIp(req.socket.remoteAddress);
      if ((perIp.get(from) || 0) >= maxPerIp) return refuse(socket, '429 Too Many Requests');
      const adminOk = auth.mayControl(req) && sameOrigin(req);
      const ws = upgrade(req, socket);
      if (!ws) return;
      perIp.set(from, (perIp.get(from) || 0) + 1); sockets.add(ws);
      const id = randomBytes(8).toString('hex');
      let tokens = burst, last = Date.now(), proven = false;
      relay.connect(id, (obj) => ws.send(JSON.stringify(obj), obj.type === 'm'), adminOk, from);
      ws.keepAlive(pingMs, pongMs);
      // A connection that never sends anything this relay understands is not a page: drop it. (One that has sent a valid
      // message may then sit quiet as long as it likes, like an unpaired control page.)
      const idle = setTimeout(() => { if (!proven) ws.close(1008); }, idleMs);
      idle.unref();
      ws.on('message', (text) => {
        const t = Date.now();
        tokens = Math.min(burst, tokens + (t - last) * rate / 1000); last = t;
        if (--tokens < 0) return ws.close(1008);                          // far faster than any page sends
        try { if (relay.handle(id, JSON.parse(text))) proven = true; } catch { /* not JSON */ }
      });
      ws.on('close', () => {
        clearTimeout(idle); sockets.delete(ws); relay.disconnect(id);
        const n = (perIp.get(from) || 1) - 1;
        if (n > 0) perIp.set(from, n); else perIp.delete(from);
      });
    } catch { socket.destroy(); }
  });
  server.on('close', () => { clearInterval(sweep); writeSessions(); });

  return {
    server, relay, auth,
    listen: () => new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, () => ok(server.address().port)); }),
    /** Write any pending sessions to disk now (the save is otherwise delayed half a second). */
    flush: writeSessions,
    /** For tests and monitoring: open WebSocket count and the most unsent bytes queued for any one of them. */
    stats: () => ({ sockets: sockets.size, maxQueued: Math.max(0, ...[...sockets].map((w) => w.socket.writableLength || 0)) }),
    close: () => new Promise((ok) => {
      writeSessions();
      for (const ws of sockets) ws.close(1001);                          // "going away": screens reconnect when we are back
      server.closeAllConnections(); server.close(ok);
    }),
  };
}
