import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, load, save, DEFAULTS } from '../src/settings.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('bad input falls back to defaults', () => {
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.deepEqual(sanitize({ color: 'red', glow: 'x', sens: NaN }), DEFAULTS);
});
test('numbers are clamped', () => {
  const s = sanitize({ glow: 99, sens: -99, gate: 5 });
  assert.equal(s.glow, 2); assert.equal(s.sens, -20); assert.equal(s.gate, 0.9);
});
test('round trip through storage', () => {
  const st = mem();
  save({ ...DEFAULTS, face: 'skull', color: '#00ff00' }, st);
  assert.equal(load(st).face, 'skull');
  assert.equal(load(st).color, '#00ff00');
});
test('corrupt storage gives defaults', () => {
  const st = mem(); st.setItem('face-characters.settings.v1', '{nope');
  assert.deepEqual(load(st), DEFAULTS);
});
