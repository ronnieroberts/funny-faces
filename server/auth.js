// Who may control the faces. On the computer running the server (localhost) nobody needs a password.
// If the control page is opened to the home network (FACES_LAN_CONTROL=1) the first visitor sets a password and
// everyone after that logs in. Screens never need one: they pair with a code.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const COOKIE = 'ff_session', DAYS = 30, MIN_PASSWORD = 8;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOCAL_ADDR = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function hostName(req) { return String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase(); }

/** True only for a browser on this very computer. The Host check stops a web page from reaching in by DNS trickery. */
export function isLocal(req) {
  return LOCAL_ADDR.has(req.socket.remoteAddress) && LOCAL_HOSTS.has(hostName(req)) && !req.headers['x-forwarded-for'];
}

/** A browser WebSocket always sends Origin; it has to be this server, not some other web page. */
export function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { return false; }
}

export class Auth {
  constructor(dir, { lanControl = false } = {}) {
    this.lanControl = lanControl; this.file = join(dir, 'auth.json'); this.fails = new Map();
    mkdirSync(dir, { recursive: true });
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    if (!this.data.secret) { this.data.secret = randomBytes(32).toString('hex'); this._save(); }
  }

  _save() { writeFileSync(this.file, JSON.stringify(this.data)); try { chmodSync(this.file, 0o600); } catch { /* not supported */ } }
  get hasPassword() { return !!this.data.hash; }

  setPassword(pw) {
    if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    const salt = randomBytes(16);
    this.data.hash = salt.toString('hex') + ':' + scryptSync(pw, salt, 32).toString('hex');
    this._save();
  }

  checkPassword(pw, ip = '') {
    const now = Date.now(), f = this.fails.get(ip) || { n: 0, at: now };
    if (now - f.at > 60000) { f.n = 0; f.at = now; }
    if (f.n >= 8) return false;                                         // slow down guessing
    let ok = false;
    if (this.hasPassword && typeof pw === 'string') {
      const [salt, hash] = this.data.hash.split(':');
      ok = timingSafeEqual(scryptSync(pw, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'));
    }
    if (!ok) { f.n++; this.fails.set(ip, f); } else this.fails.delete(ip);
    return ok;
  }

  /** A signed cookie value: expiry.mac. Stateless, so a restart does not log anyone out. */
  token() {
    const exp = Date.now() + DAYS * 86400000;
    return `${exp}.${createHmac('sha256', this.data.secret).update(String(exp)).digest('hex')}`;
  }
  cookie(token) { return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DAYS * 86400}`; }

  loggedIn(req) {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
    if (!m) return false;
    const [exp, mac] = m[1].split('.');
    if (!(Number(exp) > Date.now()) || !mac) return false;
    const want = createHmac('sha256', this.data.secret).update(exp).digest('hex');
    return mac.length === want.length && timingSafeEqual(Buffer.from(mac), Buffer.from(want));
  }

  /** May this request run the control page? */
  mayControl(req) { return isLocal(req) || (this.lanControl && this.hasPassword && this.loggedIn(req)); }
}
