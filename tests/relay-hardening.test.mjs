import test from 'node:test';
import assert from 'node:assert/strict';
import { Relay } from '../server/relay.js';

function conn(relay, id, adminOk, ip = '10.0.0.1') { const got = []; relay.connect(id, (o) => got.push(o), adminOk, ip); return got; }
function pairUp(relay) {
  const screen = conn(relay, 's', false), admin = conn(relay, 'a', true);
  relay.handle('s', { action: 'register' });
  relay.handle('a', { action: 'pair', code: screen[0].code });
  return { screen, admin, session: admin.at(-1).session, key: admin.at(-1).key };
}

test('M9: screens are told when the control page goes away, and when it comes back', () => {
  const r = new Relay();
  const { screen, session, key } = pairUp(r);
  r.disconnect('a');
  assert.deepEqual(screen.at(-1), { type: 'admin_gone' });
  const a2 = conn(r, 'a2', true);
  r.handle('a2', { action: 'admin', session, key });
  assert.deepEqual(screen.at(-1), { type: 'admin_back' });
  assert.equal(a2.at(-1).type, 'ready');
});

test('M9: a screen that joins while nobody controls the session is told, and hears admin_back after a restart-style reconnect', () => {
  const store = {};
  const r1 = new Relay({ onSessions: (s) => Object.assign(store, JSON.parse(JSON.stringify(s))) });
  const { session, key } = pairUp(r1);
  const r2 = new Relay({ sessions: store });
  const s2 = conn(r2, 's2', false);
  r2.handle('s2', { action: 'screen', session });
  assert.deepEqual(s2.map((m) => m.type), ['paired', 'admin_gone']);
  conn(r2, 'a2', true);
  r2.handle('a2', { action: 'admin', session, key });
  assert.equal(s2.at(-1).type, 'admin_back');
});

test('M9: an old control page tab closing does not announce admin_gone while a newer one is connected', () => {
  const r = new Relay();
  const { screen, session, key } = pairUp(r);
  conn(r, 'a2', true);
  r.handle('a2', { action: 'admin', session, key });
  r.disconnect('a');
  assert.ok(!screen.some((m) => m.type === 'admin_gone'));
  r.disconnect('a2');
  assert.equal(screen.at(-1).type, 'admin_gone');
});

test('M9: ending the session does not follow with admin_gone', () => {
  const r = new Relay();
  const { screen } = pairUp(r);
  r.handle('a', { action: 'end' });
  r.disconnect('a');
  assert.ok(!screen.some((m) => m.type === 'admin_gone'));
});

test('an action that is a prototype property is ignored: __proto__, constructor, toString, hasOwnProperty', () => {
  const r = new Relay();
  const g = conn(r, 'g', true);
  for (const action of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const msg = JSON.parse(`{"action":"${action}"}`);
    assert.doesNotThrow(() => r.handle('g', msg), action);
    assert.equal(r.handle('g', msg), false);
  }
  assert.equal(g.length, 0);
});

test('handle() says whether the message was one the relay speaks (ping counts, junk does not)', () => {
  const r = new Relay();
  conn(r, 'g', false);
  assert.equal(r.handle('g', { action: 'ping' }), true);
  assert.equal(r.handle('g', { action: 'nope' }), false);
  assert.equal(r.handle('g', 'text'), false);
  assert.equal(r.handle('g', null), false);
});

test('a session id of __proto__ or constructor is just an unknown session', () => {
  const r = new Relay();
  const g = conn(r, 'g', false);
  r.handle('g', { action: 'screen', session: '__proto__' });
  r.handle('g', { action: 'screen', session: 'constructor' });
  assert.deepEqual(g.map((m) => m.error), ['unknown_session', 'unknown_session']);
});

test('saved sessions from disk are validated: bad entries are dropped, corrupt state cannot throw', () => {
  const now = 1000;
  const r = new Relay({ now: () => now, sessions: {
    good: { key: 'k', state: '{"a":1}', ttl: now + 100 },
    noTtl: { key: 'k', state: '' },
    strTtl: { key: 'k', state: '', ttl: '9999999999' },
    nullTtl: { key: 'k', state: '', ttl: null },
    noKey: { state: '', ttl: now + 100 },
    numKey: { key: 5, state: '', ttl: now + 100 },
    arr: [], nul: null, str: 'x', num: 7,
    badState: { key: 'k2', state: 'not json {', ttl: now + 100 },
    arrState: { key: 'k3', state: '[1,2]', ttl: now + 100 },
    numState: { key: 'k4', state: 42, ttl: now + 100 },
    hugeState: { key: 'k5', state: '{"x":"' + 'y'.repeat(300000) + '"}', ttl: now + 100 },
  } });
  assert.deepEqual([...r.sessions.keys()].sort(), ['arrState', 'badState', 'good', 'hugeState', 'numState']);
  assert.equal(r.sessions.get('good').state, '{"a":1}');
  for (const k of ['arrState', 'badState', 'numState', 'hugeState']) assert.equal(r.sessions.get(k).state, '', k);
  const s = conn(r, 's', false);
  for (const session of ['badState', 'arrState', 'numState', 'good']) assert.doesNotThrow(() => r.handle('s', { action: 'screen', session }), session);
  for (const bad of [null, 'text', 5, [], { x: 1 }]) assert.doesNotThrow(() => new Relay({ sessions: bad }));
  assert.ok(s.length > 0);
});
