import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, load, save, resize, defaultPumpkins, DEFAULTS } from '../src/settings.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('bad input falls back to defaults', () => {
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.deepEqual(sanitize({ color: 'red', glow: 'x', sens: NaN }), DEFAULTS);
});
test('numbers are clamped', () => {
  const s = sanitize({ glow: 99, adv: { inputDb: -99, gate: 5, outputGain: 99, snap: -1 }, turnPause: 0 });
  assert.equal(s.glow, 2); assert.equal(s.adv.inputDb, -30); assert.equal(s.adv.gate, 0.9);
  assert.equal(s.adv.outputGain, 2); assert.equal(s.adv.snap, 0); assert.equal(s.turnPause, 0.1);
});
test('settings saved by version 1.0.1 are carried over', () => {
  const s = sanitize({ face: 'starter/skull', sens: 6, gate: 0.5, color: '#112233', size: 1.1 });
  assert.equal(s.pumpkins.length, 1);
  assert.equal(s.pumpkins[0].face, 'starter/skull');
  assert.equal(s.adv.inputDb, 6); assert.equal(s.adv.gate, 0.5);
  assert.equal(s.color, '#112233'); assert.equal(s.size, 1.1);
});
test('at most eight pumpkins, each one cleaned up', () => {
  const s = sanitize({ pumpkins: Array.from({ length: 12 }, () => ({ voice: 'nope', trim: 99, scale: 0, color: 'red', face: 5 })) });
  assert.equal(s.pumpkins.length, 8);
  assert.equal(s.pumpkins[0].voice, 'full'); assert.equal(s.pumpkins[0].trim, 20);
  assert.equal(s.pumpkins[0].scale, 0.2); assert.equal(s.pumpkins[0].color, '');
  assert.equal(sanitize({ mode: 'nonsense' }).mode, 'sync');
  assert.equal(sanitize({ mode: 'random' }).mode, 'random');
});
test('resizing keeps what is there and adds new pumpkins with their own voices', () => {
  const two = resize(defaultPumpkins(1), 4);
  assert.equal(two.length, 4);
  assert.deepEqual(new Set(two.map((p) => p.face)).size > 1, true);
  const kept = resize([{ ...two[0], face: 'starter/skull' }], 3);
  assert.equal(kept[0].face, 'starter/skull');
  assert.equal(resize(two, 99).length, 8);
  assert.equal(resize(two, 0).length, 1);
});
test('round trip through storage', () => {
  const st = mem();
  save({ ...DEFAULTS, pumpkins: [{ ...DEFAULTS.pumpkins[0], face: 'skull' }], color: '#00ff00' }, st);
  assert.equal(load(st).pumpkins[0].face, 'skull');
  assert.equal(load(st).color, '#00ff00');
});
test('corrupt storage gives defaults', () => {
  const st = mem(); st.setItem('face-characters.settings.v1', '{nope');
  assert.deepEqual(load(st), DEFAULTS);
});
