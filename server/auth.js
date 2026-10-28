// Who may control the faces. On the computer running the server (localhost) nobody needs a password.
// If the control page is opened to the home network (FACES_LAN_CONTROL=1) the first visitor sets a password and
// everyone after that logs in. Screens never need one: they pair with a code.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const COOKIE = 'ff_session', DAYS = 30, MIN_PASSWORD = 8;
const PW_TRIES = 8, PW_LOCK_MS = 60000;                      // wrong passwords per address, then a one-minute lockout
const CODE_TRIES = 5, CODE_LOCK_MS = 15 * 60000, CODE_TOTAL = 20;   // wrong setup codes: per address, lockout, and in total
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
  /** onNewCode(code) is called when the setup code was regenerated after too many wrong guesses (default: print it). */
  constructor(dir, { lanControl = false, now = () => Date.now(), onNewCode = (c) => console.log(`\n  Too many wrong setup codes. New setup code: ${c}\n`) } = {}) {
    this.lanControl = lanControl; this.setupCode = ''; this.file = join(dir, 'auth.json'); this.fails = new Map();
    this.now = now; this.onNewCode = onNewCode; this.codeFails = new Map(); this.codeFailTotal = 0;
    mkdirSync(dir, { recursive: true });
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    if (!this.data.secret) { this.data.secret = randomBytes(32).toString('hex'); this._save(); }
  }

  /** Shown only in the terminal, so the first person to set the LAN password has to be someone who can see it. */
  needSetupCode() {
    if (this.lanControl && !this.hasPassword && !this.setupCode) this.setupCode = randomBytes(4).toString('hex').toUpperCase();
    return this.setupCode;
  }

  _save() {                                                              // temp file then rename: never a half-written auth.json
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* not supported */ }
    renameSync(tmp, this.file);
  }
  get hasPassword() { return !!this.data.hash; }
  /** Seconds this address must wait before trying the setup code again (0 = not locked). */
  setupLockedFor(ip = '') {
    const f = this.codeFails.get(ip), left = f && f.until ? f.until - this.now() : 0;
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /** 5 wrong tries lock that address out for 15 minutes; 20 wrong tries in total replace the code with a new one. */
  checkSetupCode(code, ip = '') {
    if (this.setupLockedFor(ip)) return false;
    const a = Buffer.from(String(code || '').trim().toUpperCase()), b = Buffer.from(this.setupCode);
    const ok = b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    if (ok) { this.codeFails.delete(ip); return true; }
    const f = this.codeFails.get(ip) || { n: 0, until: 0 };
    if (f.until) { f.n = 0; f.until = 0; }                               // a served lockout starts a fresh count
    if (++f.n >= CODE_TRIES) f.until = this.now() + CODE_LOCK_MS;
    this.codeFails.set(ip, f);
    if (++this.codeFailTotal >= CODE_TOTAL && this.setupCode) {
      this.setupCode = ''; this.codeFailTotal = 0; this.codeFails.clear();
      this.onNewCode(this.needSetupCode());
    }
    return false;
  }

  /** Forget old failure records so the maps cannot grow without bound. */
  sweep() {
    const t = this.now();
    for (const [ip, f] of this.fails) if (f.until ? f.until < t : t - f.at > PW_LOCK_MS) this.fails.delete(ip);
    for (const [ip, f] of this.codeFails) if (f.until && f.until < t) this.codeFails.delete(ip);
  }

  setPassword(pw) {
    if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    const salt = randomBytes(16);
    this.data.hash = salt.toString('hex') + ':' + scryptSync(pw, salt, 32).toString('hex');
    this._save();
  }

  /** Seconds this address must wait before trying a password again (0 = not locked). */
  lockedFor(ip = '') {
    const f = this.fails.get(ip), left = f && f.until ? f.until - this.now() : 0;
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  checkPassword(pw, ip = '') {
    const now = this.now();
    if (this.lockedFor(ip)) return false;                               // slow down guessing
    let f = this.fails.get(ip);
    if (!f || now - f.at > PW_LOCK_MS) f = { n: 0, at: now, until: 0 };
    let ok = false;
    if (this.hasPassword && typeof pw === 'string') {
      const [salt, hash] = this.data.hash.split(':');
      ok = timingSafeEqual(scryptSync(pw, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'));
    }
    if (!ok) { if (++f.n >= PW_TRIES) f.until = now + PW_LOCK_MS; this.fails.set(ip, f); } else this.fails.delete(ip);
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
