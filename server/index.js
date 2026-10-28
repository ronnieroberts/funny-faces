// Funny Faces server: serves the page, relays mouth data to paired screens, and decides who may control.
// No dependencies. Control from this computer needs no password; a TV opens /?screen and pairs with a code.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Auth, isLocal, sameOrigin } from './auth.js';
import { Relay } from './relay.js';
import { upgrade } from './ws.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:18px system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:26rem;padding:2rem}input,button{font:inherit;padding:.6rem;margin:.3rem 0;width:100%;box-sizing:border-box;border-radius:8px;border:1px solid #444;background:#222;color:#eee}
button{background:#e8741a;border:0;color:#111;font-weight:600}small{color:#aaa}</style><main>${body}</main>`;

const form = (title, intro, extra) => page(title, `<h1>${title}</h1><p>${intro}</p>
<form id="f"><input id="pw" type="password" autocomplete="${extra.auto}" placeholder="Password" minlength="8" required autofocus>
<button>${extra.button}</button><small id="m"></small></form>
<script>f.onsubmit=async e=>{e.preventDefault();const r=await fetch('${extra.api}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw.value})});
if(r.ok)location.href='/';else m.textContent=(await r.json().catch(()=>({}))).error||'Try again'}</script>`);

/** LAN addresses a TV can use to reach this computer, nicest first. */
export function lanUrls(port) {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b)).map((ip) => `http://${ip}:${port}`);
}

export function createApp({ port = 8765, host = '0.0.0.0', dataDir = './data', distDir = './dist', lanControl = false } = {}) {
  const auth = new Auth(dataDir, { lanControl });
  const sessFile = join(dataDir, 'sessions.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(sessFile, 'utf8')); } catch { /* first run */ }
  let saveTimer = null;
  const relay = new Relay({ sessions: saved, onSessions: (s) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const clean = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { key: v.key, state: v.state, ttl: v.ttl }]));
      try { writeFileSync(sessFile, JSON.stringify(clean)); } catch { /* read-only disk: sessions just will not survive a restart */ }
    }, 500);
  } });
  const sweep = setInterval(() => relay.sweep(), 60000);

  const json = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((ok) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 4096) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(b)); } catch { ok({}); } });
  });
  const ip = (req) => req.socket.remoteAddress || '';

  async function onRequest(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');

    if (path === '/api/info') {
      return json(res, 200, { urls: lanUrls(server.address().port), local: isLocal(req), lanControl, mayControl: auth.mayControl(req) });
    }
    if (req.method === 'POST' && (path === '/api/setup' || path === '/api/login')) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Not allowed' });
      const { password } = await readBody(req);
      if (!lanControl) return json(res, 403, { error: 'Control from other devices is turned off' });
      if (path === '/api/setup') {
        if (auth.hasPassword) return json(res, 409, { error: 'A password is already set' });
        try { auth.setPassword(password); } catch (e) { return json(res, 400, { error: e.message }); }
        return json(res, 200, { ok: true }, { 'set-cookie': auth.cookie(auth.token()) });
      }
      if (!auth.checkPassword(password, ip(req))) return json(res, 401, { error: 'Wrong password' });
      return json(res, 200, { ok: true }, { 'set-cookie': auth.cookie(auth.token()) });
    }
    if (path === '/screen') { res.writeHead(302, { location: '/?screen' }); return res.end(); }

    // The control page. A screen (?screen) is only the page: it can do nothing without a code.
    if ((path === '/' || path === '/index.html') && !url.searchParams.has('screen') && !auth.mayControl(req)) {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      if (!lanControl) return res.end(page('Funny Faces', '<h1>Funny Faces</h1><p>Controls are only available on the computer that runs Funny Faces.</p><p>On a TV or another screen, open <b>/screen</b> instead and type the code it shows into the control page.</p>'));
      return res.end(auth.hasPassword
        ? form('Log in', 'Enter the Funny Faces password.', { api: '/api/login', button: 'Log in', auto: 'current-password' })
        : form('Set a password', 'First time here. Choose a password for controlling Funny Faces from other devices (8 or more characters).', { api: '/api/setup', button: 'Save password', auto: 'new-password' }));
    }

    // static files
    const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '') || 'index.html';
    let file = join(distDir, rel);
    if (!file.startsWith(join(distDir) + sep) && file !== join(distDir)) { res.writeHead(403); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    const hashed = /\.[0-9a-f]{10}\.js$/.test(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': hashed ? 'public,max-age=31536000,immutable' : 'no-cache' });
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => { onRequest(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* gone */ } }); });
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    const adminOk = auth.mayControl(req) && sameOrigin(req);
    const ws = upgrade(req, socket);
    if (!ws) return;
    const id = randomBytes(8).toString('hex');
    relay.connect(id, (obj) => ws.send(JSON.stringify(obj)), adminOk);
    ws.on('message', (text) => { try { relay.handle(id, JSON.parse(text)); } catch { /* not JSON */ } });
    ws.on('close', () => relay.disconnect(id));
  });
  server.on('close', () => { clearInterval(sweep); clearTimeout(saveTimer); });

  return {
    server, relay, auth,
    listen: () => new Promise((ok) => server.listen(port, host, () => ok(server.address().port))),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }),
  };
}
