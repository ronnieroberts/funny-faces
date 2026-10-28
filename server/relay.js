// Pairs display screens with the control page and forwards what the control page sends. In memory, one process.
// Same JSON protocol the page has always spoken: {action: register | pair | admin | screen | state | m | end | ping}.
//   register  a screen asks for a 6 character code
//   pair      the control page types that code; both sides get "paired"
//   state     the face and look (rarely); the latest is kept so a screen that joins later gets it
//   m         three mouth bytes, about 15 a second, forwarded to every paired screen
import { randomInt, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';     // no 0/O, 1/I/L
const CODE_LEN = 6, CODE_TTL = 600, SESSION_TTL = 30 * 86400, MAX_STATE = 60000, MAX_ATTEMPTS = 10;
const ADMIN_ACTIONS = new Set(['pair', 'admin', 'state', 'm', 'end']);

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const seq = (body) => (Number.isInteger(body.n) && body.n >= 0 && body.n < 2 ** 31 ? { n: body.n } : {});

export class Relay {
  /** sessions: optional saved {id: {key, state, ttl}} so screens survive a restart. onSessions(obj) is called on change. */
  constructor({ now = () => Math.floor(Date.now() / 1000), sessions = {}, onSessions = () => {} } = {}) {
    this.now = now; this.onSessions = onSessions;
    this.conns = new Map(); this.codes = new Map(); this.sessions = new Map(Object.entries(sessions));
  }

  connect(id, send, adminOk) { this.conns.set(id, { send, adminOk: !!adminOk, role: null, session: null, attempts: 0 }); }

  disconnect(id) {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (!c) return;
    if (c.code) this.codes.delete(c.code);
    if (c.role === 'screen' && c.session) this._tellAdmin(c.session);
  }

  handle(id, body) {
    const c = this.conns.get(id);
    const action = body && typeof body === 'object' ? body.action : null;
    if (!c || typeof action !== 'string') return;
    if (ADMIN_ACTIONS.has(action) && !c.adminOk) return this._error(c, 'not_admin');
    const fn = { register: this.register, pair: this.pair, admin: this.admin, screen: this.screen,
      state: this.state, m: this.mouth, end: this.end }[action];
    if (fn) fn.call(this, id, c, body);
  }

  _send(c, obj) { try { c.send(obj); } catch { /* the socket is closing; disconnect() will tidy up */ } }
  _error(c, error) { this._send(c, { type: 'error', error }); }
  _screens(session) { return [...this.conns.values()].filter((c) => c.role === 'screen' && c.session === session); }
  _fanOut(session, obj) { for (const s of this._screens(session)) this._send(s, obj); }
  _checkSession(session, key) {
    const s = typeof session === 'string' ? this.sessions.get(session) : null;
    return s && typeof key === 'string' && same(s.key, key) ? s : null;
  }
  _save() { this.onSessions(Object.fromEntries(this.sessions)); }

  /** Forget old codes and sessions. Call now and then. */
  sweep() {
    const t = this.now();
    for (const [code, e] of this.codes) if (e.ttl < t) this.codes.delete(code);
    let changed = false;
    for (const [id, s] of this.sessions) if (s.ttl < t) { this.sessions.delete(id); changed = true; }
    if (changed) this._save();
  }

  register(id, c) {
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const tryCode = Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      if (!this.codes.has(tryCode)) code = tryCode;
    }
    if (!code) return this._error(c, 'busy');
    if (c.code) this.codes.delete(c.code);
    c.role = 'screen'; c.code = code;
    this.codes.set(code, { conn: id, ttl: this.now() + CODE_TTL });
    this._send(c, { type: 'code', code, expires: CODE_TTL });
  }

  pair(id, c, body) {
    if (c.attempts >= MAX_ATTEMPTS) return this._error(c, 'too_many_attempts');
    const code = String(body.code || '').trim().toUpperCase();
    const entry = code.length === CODE_LEN ? this.codes.get(code) : null;
    if (entry) this.codes.delete(code);
    const screen = entry && entry.ttl >= this.now() ? this.conns.get(entry.conn) : null;
    if (!screen) { c.attempts++; return this._error(c, 'bad_code'); }
    let session = body.session, sess = this._checkSession(session, body.key);
    if (!sess) {
      session = randomBytes(12).toString('base64url');
      sess = { key: randomBytes(12).toString('base64url'), state: '', ttl: 0 };
    }
    sess.ttl = this.now() + SESSION_TTL;
    this.sessions.set(session, sess);
    this._save();
    c.role = 'admin'; c.session = session; c.attempts = 0; sess.admin = id;
    screen.role = 'screen'; screen.session = session; screen.code = null;
    this._send(screen, { type: 'paired', session });
    if (sess.state) this._send(screen, { type: 'state', state: JSON.parse(sess.state) });
    this._send(c, { type: 'paired', session, key: sess.key, screens: this._screens(session).length });
  }

  admin(id, c, body) {
    const sess = this._checkSession(body.session, body.key);
    if (!sess) return this._error(c, 'unknown_session');
    c.role = 'admin'; c.session = body.session; c.attempts = 0; sess.admin = id;
    sess.ttl = this.now() + SESSION_TTL;
    this._send(c, { type: 'ready', screens: this._screens(body.session).length });
  }

  screen(id, c, body) {
    const sess = typeof body.session === 'string' ? this.sessions.get(body.session) : null;
    if (!sess) return this._error(c, 'unknown_session');
    c.role = 'screen'; c.session = body.session;
    this._send(c, { type: 'paired', session: body.session });
    if (sess.state) this._send(c, { type: 'state', state: JSON.parse(sess.state) });
    this._tellAdmin(body.session);
  }

  _tellAdmin(session) {
    const sess = this.sessions.get(session), admin = sess && sess.admin ? this.conns.get(sess.admin) : null;
    if (admin) this._send(admin, { type: 'screens', n: this._screens(session).length });
  }

  state(id, c, body) {
    const st = body.state;
    if (c.role !== 'admin' || !c.session || !st || typeof st !== 'object' || Array.isArray(st)) return this._error(c, 'not_admin');
    const raw = JSON.stringify(st);
    if (raw.length > MAX_STATE) return this._error(c, 'too_large');
    const sess = this.sessions.get(c.session);
    if (sess) { sess.state = raw; this._save(); }
    this._fanOut(c.session, { type: 'state', state: st, ...seq(body) });
  }

  mouth(id, c, body) {
    const v = body.v;
    if (c.role !== 'admin' || !c.session || !Array.isArray(v) || v.length !== 3 || !v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return;
    if (!this._screens(c.session).length) return this._send(c, { type: 'screens', n: 0 });
    this._fanOut(c.session, { type: 'm', v, ...seq(body) });
  }

  end(id, c) {
    if (c.role !== 'admin' || !c.session) return;
    this._fanOut(c.session, { type: 'ended' });
    this.sessions.delete(c.session);
    this._save();
  }
}
