import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, validatePack, drawFace } from '../src/facepack.js';
import { buildState, parseState } from '../src/share.js';
import { DEFAULTS } from '../src/settings.js';

const pack = (layers, version = 2) => ({ format: 'pumpkin-face-pack', version, id: 'p', name: 'P', faces: [{ id: 'f', name: 'F', layers }] });

test('path data: every command becomes absolute M, L, C, Q or Z', () => {
  assert.deepEqual(parsePath('M10 10 L20 20 h5 v5 z'), [['M', 10, 10], ['L', 20, 20], ['L', 25, 20], ['L', 25, 25], ['Z']]);
  assert.deepEqual(parsePath('m10,10 l5,5 5,0'), [['M', 10, 10], ['L', 15, 15], ['L', 20, 15]]);     // relative, and a repeated command
  assert.deepEqual(parsePath('M0 0 C1 2 3 4 5 6 S7 8 9 10'), [['M', 0, 0], ['C', 1, 2, 3, 4, 5, 6], ['C', 7, 8, 7, 8, 9, 10]]);
  assert.deepEqual(parsePath('M0 0 Q1 1 2 2 T4 4'), [['M', 0, 0], ['Q', 1, 1, 2, 2], ['Q', 3, 3, 4, 4]]);
  assert.deepEqual(parsePath('M50 50 L1e1 1.5e1'), [['M', 50, 50], ['L', 10, 15]]);
});

test('path data: arcs, junk and oversized input are refused, coordinates are clamped', () => {
  for (const bad of ['', 'L5 5', 'M0 0 A1 1 0 0 1 5 5', 'M0 0 L5', 'M0 0 L5 5 foo', 'M0 0 <script>', 'M0 0 L5 5 6', 'x'.repeat(30000)]) {
    assert.throws(() => parsePath(bad), undefined, bad.slice(0, 20));
  }
  assert.throws(() => parsePath('M0 0 ' + 'L1 1 '.repeat(900)), /too long/);
  assert.deepEqual(parsePath('M-500 999 L5 5'), [['M', -20, 120], ['L', 5, 5]]);
});

test('a path layer needs a version 2 pack and a stroke or a fill', () => {
  const layer = { kind: 'path', d: 'M10 10 C20 0 30 0 40 10', stroke: 1.4 };
  assert.equal(validatePack(pack([layer])).faces[0].layers[0].kind, 'path');
  assert.throws(() => validatePack(pack([layer], 1)), /version 2/);
  assert.throws(() => validatePack(pack([{ ...layer, stroke: 0 }])), /stroke or a fill/);
  assert.throws(() => validatePack(pack([{ kind: 'path', d: 'M0 0 A1 1 0 0 1 5 5' }])));
  assert.equal(validatePack(pack([{ kind: 'path', d: 'M10 10 L20 10 L15 20 Z', fill: true, stroke: 0 }])).faces[0].layers[0].fill, true);
  assert.equal(validatePack(pack([{ kind: 'shape', points: [[1, 1], [2, 2], [3, 1]] }], 1)).version, 1);     // version 1 packs are unchanged
});

test('a validated path pack survives a second validation (it is what travels to the screens)', () => {
  const once = validatePack(pack([{ kind: 'path', d: 'M10 10 c5 -5 10 -5 15 0', stroke: 2, opacity: 0.5, mirror: true, blink: true, react: { dy: -3 } }]));
  const twice = validatePack(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice.faces[0].layers[0].ops, once.faces[0].layers[0].ops);
  assert.equal(twice.faces[0].layers[0].opacity, 0.5);
});

// a drawing context that only records what was called
const recorder = () => {
  const calls = [], ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; if (k === 'lineWidth') calls.push(['lineWidth', v]); return true; } });
  return { ctx, calls };
};
const st = { open: 0, bright: 0.5, energy: 0, blink: 0, color: '#ff8a1f', glow: 0.5, alpha: 1 };

test('drawing a path layer strokes curves; mirror draws a second copy flipped about the middle', () => {
  const face = validatePack(pack([{ kind: 'path', d: 'M10 20 C20 10 30 10 40 20', stroke: 1.5, mirror: true }])).faces[0];
  const { ctx, calls } = recorder();
  drawFace(ctx, face, 200, st);
  const curves = calls.filter((c) => c[0] === 'bezierCurveTo'), moves = calls.filter((c) => c[0] === 'moveTo');
  assert.equal(curves.length, 2);
  assert.deepEqual(moves.map((m) => m.slice(1)), [[10, 20], [90, 20]]);
  assert.deepEqual(curves[1].slice(1), [80, 10, 70, 10, 60, 20]);
  assert.equal(calls.filter((c) => c[0] === 'stroke').length, 2);
  assert.ok(calls.some((c) => c[0] === 'lineWidth' && c[1] === 1.5));
});

test('a blinking path squashes towards its middle, and a react path moves with the voice', () => {
  const face = validatePack(pack([{ kind: 'path', d: 'M10 10 L30 30', stroke: 1, blink: true, react: { dy: -4 } }])).faces[0];
  const { ctx, calls } = recorder();
  drawFace(ctx, face, 100, { ...st, blink: 1, energy: 1 });
  const ys = calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo').map((c) => c[2]);
  assert.ok(Math.abs(ys[0] - (20 + (10 - 20) * 0.1 - 4)) < 1e-9);     // y 10 about the middle 20, squashed to 10 percent, lifted 4
});

test('path layers pass through the screens state', () => {
  const face = validatePack(pack([{ kind: 'path', d: 'M10 10 L20 20', stroke: 1 }])).faces[0];
  const settings = { ...DEFAULTS, pumpkins: [{ ...DEFAULTS.pumpkins[0], face: 'f' }] };
  const state = JSON.parse(JSON.stringify(buildState(settings, () => face)));
  const got = parseState(state);
  assert.equal(got.pumpkins[0].face.layers[0].kind, 'path');
});
