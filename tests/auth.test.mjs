import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Auth, isLocal, sameOrigin, hostName } from '../server/auth.js';

function withAuth(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ff-auth-'));
  try { return fn(new Auth(dir, opts), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const req = (headers = {}, addr = '127.0.0.1') => ({ headers, socket: { remoteAddress: addr } });

test('auth.json is created private (0600) with a 256-bit secret, written atomically (no temp file left)', () => {
  withAuth({}, (auth, dir) => {
    assert.equal(auth.data.secret.length, 64);
    if (process.platform !== 'win32') assert.equal(statSync(auth.file).mode & 0o777, 0o600);
    assert.equal(existsSync(auth.file + '.tmp'), false);
    auth.setPassword('password123');
    if (process.platform !== 'win32') assert.equal(statSync(auth.file).mode & 0o777, 0o600);
    assert.equal(existsSync(auth.file + '.tmp'), false);
  });
});

test('setPassword rejects short passwords and stores only a salted hash', () => {
  withAuth({}, (auth) => {
    assert.throws(() => auth.setPassword('1234567'), /at least 8 characters/);
    assert.throws(() => auth.setPassword(12345678), /at least 8 characters/);
    auth.setPassword('password123');
    assert.ok(auth.hasPassword);
    const saved = JSON.parse(readFileSync(auth.file, 'utf8'));
    assert.match(saved.hash, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
    assert.ok(!readFileSync(auth.file, 'utf8').includes('password123'));
  });
});

test('checkPassword: wrong, right, and not a string', () => {
  withAuth({}, (auth) => {
    assert.equal(auth.checkPassword('anything'), false);                 // no password set yet
    auth.setPassword('password123');
    assert.equal(auth.checkPassword('wrongpass'), false);
    assert.equal(auth.checkPassword('password123'), true);
    assert.equal(auth.checkPassword(123), false);
    assert.equal(auth.checkPassword(null), false);
  });
});

test('8 wrong passwords lock an address out for a minute, even for the right password; other addresses are unaffected', () => {
  let t = 1_000_000;
  withAuth({ now: () => t }, (auth) => {
    auth.setPassword('password123');
    for (let i = 0; i < 8; i++) assert.equal(auth.checkPassword('wrongpass', '10.0.0.1'), false);
    assert.ok(auth.lockedFor('10.0.0.1') > 0);
    assert.equal(auth.lockedFor('10.0.0.2'), 0);
    assert.equal(auth.checkPassword('password123', '10.0.0.1'), false);
    assert.equal(auth.checkPassword('password123', '10.0.0.2'), true);
    t += 61000;
    assert.equal(auth.lockedFor('10.0.0.1'), 0);
    assert.equal(auth.checkPassword('password123', '10.0.0.1'), true);
  });
});

test('the failure maps are swept so they cannot grow forever', () => {
  let t = 1_000_000;
  withAuth({ now: () => t, lanControl: true }, (auth) => {
    auth.setPassword('password123');
    for (let i = 0; i < 500; i++) { auth.checkPassword('bad bad bad', `10.1.${i >> 8}.${i & 255}`); }
    assert.equal(auth.fails.size, 500);
    t += 15 * 60000 + 1;
    auth.sweep();
    assert.equal(auth.fails.size, 0);
  });
});

test('the setup code only exists with LAN control on and no password; the same code each time', () => {
  withAuth({ lanControl: false }, (a) => assert.equal(a.needSetupCode(), ''));
  withAuth({ lanControl: true }, (a) => {
    const code = a.needSetupCode();
    assert.match(code, /^[0-9A-F]{8}$/);
    assert.equal(a.needSetupCode(), code);
  });
  withAuth({ lanControl: true }, (a) => { a.setPassword('password123'); assert.equal(a.needSetupCode(), ''); });
});

test('checkSetupCode ignores case and surrounding spaces and rejects everything else', () => {
  withAuth({ lanControl: true }, (a) => {
    const code = a.needSetupCode();
    assert.equal(a.checkSetupCode(` ${code.toLowerCase()} `), true);
    assert.equal(a.checkSetupCode('wrong'), false);
    assert.equal(a.checkSetupCode(''), false);
    assert.equal(a.checkSetupCode(undefined), false);
  });
});

test('M4: 5 wrong setup codes lock that address out; the right code is refused during the lockout, and works after it', () => {
  let t = 5_000_000;
  withAuth({ lanControl: true, now: () => t }, (a) => {
    const code = a.needSetupCode();
    for (let i = 0; i < 4; i++) { assert.equal(a.checkSetupCode('BADBAD00', '10.0.0.9'), false); assert.equal(a.setupLockedFor('10.0.0.9'), 0); }
    assert.equal(a.checkSetupCode('BADBAD00', '10.0.0.9'), false);
    assert.ok(a.setupLockedFor('10.0.0.9') > 0, 'locked after the 5th');
    assert.equal(a.checkSetupCode(code, '10.0.0.9'), false);
    assert.equal(a.checkSetupCode(code, '10.0.0.10'), true, 'another address is not locked');
    t += 15 * 60000 + 1000;
    assert.equal(a.setupLockedFor('10.0.0.9'), 0);
    assert.equal(a.checkSetupCode(code, '10.0.0.9'), true);
  });
});

test('M4: 20 wrong tries in total (spread over addresses) replace the setup code and announce the new one', () => {
  const announced = [];
  withAuth({ lanControl: true, onNewCode: (c) => announced.push(c) }, (a) => {
    const first = a.needSetupCode();
    for (let i = 0; i < 19; i++) a.checkSetupCode('BADBAD00', `10.0.${i}.1`);   // each address tries once
    assert.equal(announced.length, 0);
    assert.equal(a.setupCode, first);
    a.checkSetupCode('BADBAD00', '10.0.99.1');
    assert.equal(announced.length, 1);
    assert.match(announced[0], /^[0-9A-F]{8}$/);
    assert.notEqual(announced[0], first);
    assert.equal(a.setupCode, announced[0]);
    assert.equal(a.checkSetupCode(first, '10.0.200.1'), false, 'the old code is dead');
    assert.equal(a.checkSetupCode(announced[0], '10.0.200.1'), true);
  });
});

test('tokens and cookies round trip; tampered, expired and garbage cookies are refused', () => {
  withAuth({}, (auth) => {
    auth.setPassword('password123');
    const token = auth.token(), cookie = auth.cookie(token);
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const pair = cookie.split(';')[0];
    assert.equal(auth.loggedIn(req({ cookie: pair })), true);
    assert.equal(auth.loggedIn(req({ cookie: pair.slice(0, -3) + 'abc' })), false);
    const old = '123456789.' + createHmac('sha256', auth.data.secret).update('123456789').digest('hex');
    assert.equal(auth.loggedIn(req({ cookie: `ff_session=${old}` })), false);
    assert.equal(auth.loggedIn(req({ cookie: 'garbage' })), false);
    assert.equal(auth.loggedIn(req({})), false);
  });
});

test('isLocal, sameOrigin and hostName', () => {
  assert.equal(isLocal(req({ host: 'localhost' })), true);
  assert.equal(isLocal(req({ host: '[::1]:8765' }, '::1')), true);
  assert.equal(isLocal(req({ host: 'localhost' }, '192.168.1.1')), false);
  assert.equal(isLocal(req({ host: 'example.com' })), false);
  assert.equal(isLocal(req({ host: 'localhost', 'x-forwarded-for': '192.168.1.1' })), false);
  assert.equal(sameOrigin(req({ origin: 'http://localhost:3000', host: 'localhost:3000' })), true);
  assert.equal(sameOrigin(req({ origin: 'http://example.com', host: 'localhost:3000' })), false);
  assert.equal(sameOrigin(req({ origin: 'not a url', host: 'localhost:3000' })), false);
  assert.equal(sameOrigin(req({ host: 'localhost:3000' })), true);
  assert.equal(hostName(req({ host: 'Example.com:8080' })), 'example.com');
});

test('mayControl: this computer yes; the LAN only with LAN control, a password and the cookie', () => {
  withAuth({}, (a) => {
    assert.equal(a.mayControl(req({ host: 'localhost' })), true);
    assert.equal(a.mayControl(req({ host: 'localhost' }, '192.168.1.1')), false);
    assert.equal(a.mayControl(req({ host: 'example.com' })), false);
  });
  withAuth({ lanControl: true }, (a) => {
    assert.equal(a.mayControl(req({ host: 'tv.lan' }, '192.168.1.1')), false);       // no password set yet: nobody on the LAN
    a.setPassword('password123');
    const cookie = a.cookie(a.token()).split(';')[0];
    assert.equal(a.mayControl(req({ host: 'tv.lan', cookie }, '192.168.1.1')), true);
    assert.equal(a.mayControl(req({ host: 'tv.lan' }, '192.168.1.1')), false);
  });
});

test('a second Auth on the same folder loads the saved password and secret', () => {
  withAuth({}, (a1, dir) => {
    a1.setPassword('password123');
    const pair = a1.cookie(a1.token()).split(';')[0];
    const a2 = new Auth(dir);
    assert.ok(a2.hasPassword);
    assert.equal(a2.data.secret, a1.data.secret);
    assert.equal(a2.loggedIn(req({ cookie: pair })), true);
  });
});
