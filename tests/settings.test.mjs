import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, load, save, resize, arrange, defaultPumpkins, DEFAULTS } from '../src/settings.js';
import { isValid, centroid, sizeOf } from '../src/quad.js';

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
  assert.equal(s.pumpkins[0].quad.length, 4); assert.equal(s.pumpkins[0].color, '');
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

test('every pumpkin has a valid quad, defaulted from the grid', () => {
  const s = sanitize({ pumpkins: [{}, {}, { quad: [[0, 0], [0, 0], [0, 0], [0, 0]] }] });
  assert.ok(s.pumpkins.every((p) => isValid(p.quad)));
  assert.ok(s.pumpkins[0].quad[0][0] < s.pumpkins[1].quad[0][0]);
  assert.deepEqual(sanitize({ pumpkins: [{}, {}, {}] }).pumpkins[2].quad, s.pumpkins[2].quad);   // a bad quad gets the grid place
});
test('old dx, dy and scale settings become a quad', () => {
  const A = 16 / 9, plain = sanitize({ pumpkins: [{}] }).pumpkins[0].quad;
  const old = sanitize({ pumpkins: [{ dx: 0.5, dy: -0.25, scale: 0.5 }] }).pumpkins[0].quad;
  const [c0, c1] = [centroid(plain, A), centroid(old, A)];
  assert.ok(c1[0] > c0[0] && c1[1] < c0[1]);
  assert.ok(Math.abs(sizeOf(old, A) / sizeOf(plain, A) - 0.5) < 1e-2);
});
test('a saved quad is kept, and group x, y, size place the default one', () => {
  const quad = [[0.1, 0.1], [0.3, 0.1], [0.35, 0.4], [0.1, 0.4]];
  assert.deepEqual(sanitize({ pumpkins: [{ quad }] }).pumpkins[0].quad, quad);
  const left = sanitize({ x: -0.5, pumpkins: [{}] }).pumpkins[0].quad, mid = sanitize({ pumpkins: [{}] }).pumpkins[0].quad;
  assert.ok(left[0][0] < mid[0][0]);
});
test('arrange resets the places', () => {
  const moved = defaultPumpkins(3).map((p) => ({ ...p, quad: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3], [0.1, 0.3]] }));
  assert.deepEqual(arrange(moved)[1].quad, defaultPumpkins(3)[1].quad);
  assert.equal(arrange(moved)[0].face, moved[0].face);
});

const MOVED = [[0.1, 0.1], [0.3, 0.12], [0.28, 0.4], [0.08, 0.35]];
const custom = (n) => defaultPumpkins(n).map((p, i) => ({ ...p, quad: MOVED.map(([x, y]) => [+(x + i * 0.05).toFixed(4), y]) }));
const inStage = (q) => q.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1);

test('adding faces keeps every existing quad', () => {
  const before = custom(2), after = resize(before, 5);
  assert.equal(after.length, 5);
  before.forEach((p, i) => assert.deepEqual(after[i], p));
});
test('new faces land inside the stage, valid, and apart from each other', () => {
  const after = resize(custom(1), 4);
  after.slice(1).forEach((p) => { assert.ok(isValid(p.quad)); assert.ok(inStage(p.quad)); });
  assert.notDeepEqual(after[1].quad, after[2].quad);
  assert.deepEqual(after[3].quad, defaultPumpkins(4)[3].quad);
});
test('removing faces drops the last ones and leaves the rest alone', () => {
  const before = custom(4), after = resize(before, 2);
  assert.deepEqual(after, before.slice(0, 2));
});
test('arrange puts every face back in the default row', () => {
  const after = arrange(custom(3));
  after.forEach((p, i) => assert.deepEqual(p.quad, defaultPumpkins(3)[i].quad));
});
test('a resized list survives a save and load unchanged', () => {
  const st = mem(), list = resize(custom(2), 4);
  save({ ...DEFAULTS, pumpkins: list }, st);
  assert.deepEqual(load(st).pumpkins.map((p) => p.quad), list.map((p) => p.quad));
});
