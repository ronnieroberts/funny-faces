import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutputParams, applyOutput, screenAddress, loadScreenOutput, createWakeLock, awakeMessage } from '../src/output.js';
import { sanitize, load, DEFAULTS } from '../src/settings.js';
import { buildState } from '../src/share.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const q = (s) => new URLSearchParams(s);

test('output parameters: only what was given is returned', () => {
  assert.deepEqual(parseOutputParams(q('')), {});
  assert.deepEqual(parseOutputParams(q('mirror=1&flip=1&awake=0')), { mirror: true, flip: true, keepAwake: false });
  assert.deepEqual(parseOutputParams(q('mirror=true&flip=off')), { mirror: true, flip: false });
  assert.deepEqual(parseOutputParams(q('mirror=banana&screen')), {});
});

test('defaults and migration of old saved settings', () => {
  assert.deepEqual(DEFAULTS.output, { mirror: false, flip: false, keepAwake: true });
  assert.deepEqual(sanitize(null).output, { mirror: false, flip: false, keepAwake: true });
  const old = sanitize({ color: '#112233', glow: 1, pumpkins: [{ face: 'starter/cat' }] });   // saved before output existed
  assert.deepEqual(old.output, { mirror: false, flip: false, keepAwake: true });
  assert.equal(old.color, '#112233');
  assert.deepEqual(sanitize({ output: { mirror: true, flip: 'yes', keepAwake: false } }).output, { mirror: true, flip: false, keepAwake: false });
  const s = mem(); s.setItem('face-characters.settings.v1', JSON.stringify({ glow: 1 }));
  assert.equal(load(s).output.keepAwake, true);
});

test('share state never contains output', () => {
  const settings = sanitize({ output: { mirror: true, flip: true, keepAwake: false } });
  const st = buildState(settings, () => ({ id: 'f' }), 1);
  assert.equal('output' in st, false);
  assert.equal(JSON.stringify(st).includes('mirror'), false);
});

test('applyOutput sets and clears the body attributes', () => {
  const body = { dataset: {} };
  applyOutput({ mirror: true, flip: false }, body);
  assert.deepEqual({ ...body.dataset }, { mirror: '1' });
  applyOutput({ mirror: true, flip: true }, body);
  assert.deepEqual({ ...body.dataset }, { mirror: '1', flip: '1' });
  applyOutput({ mirror: false, flip: false }, body);
  assert.deepEqual({ ...body.dataset }, {});
});

test('screen address for the Screens tab', () => {
  const b = 'http://host.local:8765';
  assert.equal(screenAddress(b), `${b}/screen`);
  assert.equal(screenAddress(b, { mirror: true }), `${b}/screen?mirror=1`);
  assert.equal(screenAddress(b, { flip: true }), `${b}/screen?flip=1`);
  assert.equal(screenAddress(b, { mirror: true, flip: true }), `${b}/screen?mirror=1&flip=1`);
});

test('a display takes the URL once, then remembers it on that device', () => {
  const s = mem();
  assert.deepEqual(loadScreenOutput(q('screen&mirror=1'), s), { mirror: true, flip: false, keepAwake: true });
  assert.deepEqual(loadScreenOutput(q('screen'), s), { mirror: true, flip: false, keepAwake: true });       // reload keeps it
  assert.deepEqual(loadScreenOutput(q('screen&mirror=0&awake=0'), s), { mirror: false, flip: false, keepAwake: false });
});

// ---- wake lock with a fake navigator and document
function fakes({ fail = null, supported = true } = {}) {
  const listeners = {}, locks = [];
  const doc = { visibilityState: 'visible', addEventListener: (t, f) => { listeners[t] = f; } };
  const nav = supported ? { wakeLock: { request: async (type) => {
    if (fail) throw Object.assign(new Error('no'), { name: fail });
    const l = {}, s = { type, released: false, addEventListener: (t, f) => { l[t] = f; },
      release: async () => { s.released = true; if (l.release) l.release(); } };
    locks.push(s); return s;
  } } } : {};
  const hide = (v) => { doc.visibilityState = v; listeners.visibilitychange(); };
  return { doc, nav, locks, hide };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('wake lock: acquire, re-acquire when the tab shows again, release', async () => {
  const { doc, nav, locks, hide } = fakes(), seen = [];
  const w = createWakeLock(nav, doc);
  w.onchange = (s) => seen.push(s);
  await w.acquire();
  assert.equal(w.state, 'on'); assert.equal(locks.length, 1); assert.equal(locks[0].type, 'screen');
  locks[0].release(); hide('hidden');                                 // the browser drops the lock in a hidden tab
  assert.equal(w.state, 'off');
  hide('visible'); await tick();
  assert.equal(w.state, 'on'); assert.equal(locks.length, 2);
  await w.release();
  assert.equal(w.state, 'off'); assert.equal(locks[1].released, true);
  hide('visible'); await tick();
  assert.equal(locks.length, 2);                                      // stopped: no new lock
  assert.deepEqual(seen, ['on', 'off', 'on', 'off']);
});

test('wake lock: not requested while hidden, requested when shown', async () => {
  const { doc, nav, locks, hide } = fakes();
  doc.visibilityState = 'hidden';
  const w = createWakeLock(nav, doc);
  await w.acquire();
  assert.equal(locks.length, 0); assert.equal(w.state, 'off');
  hide('visible'); await tick();
  assert.equal(w.state, 'on');
});

test('wake lock: unsupported and denied', async () => {
  const a = createWakeLock(fakes({ supported: false }).nav, fakes().doc);
  await a.acquire();
  assert.equal(a.state, 'unsupported');
  await a.release();
  assert.equal(a.state, 'unsupported');
  const b = fakes({ fail: 'NotAllowedError' }), w = createWakeLock(b.nav, b.doc);
  await w.acquire();
  assert.equal(w.state, 'denied');
  assert.match(awakeMessage('denied'), /sleep timer/);
  assert.match(awakeMessage('unsupported'), /sleep timer/);
  assert.equal(awakeMessage('on'), null);
  assert.equal(awakeMessage('off'), null);
});
