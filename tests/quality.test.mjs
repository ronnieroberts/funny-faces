import test from 'node:test';
import assert from 'node:assert/strict';
import { tileSize, tileCap, tileKey, keyChanged, flameTime, quant, Governor, LEVELS } from '../src/quality.js';
import { sanitize, DEFAULTS, ADV_DEFAULTS } from '../src/settings.js';

test('tile size follows the pumpkin but never passes the cap', () => {
  assert.equal(tileSize(300), 384);
  assert.equal(tileSize(1100), 1024);
  assert.equal(tileSize(1100, 384), 384);
  assert.equal(tileSize(10, 384), 128);
});

test('more pumpkins and lower quality mean smaller tiles', () => {
  for (let l = 0; l < LEVELS.length; l++) {
    assert.ok(tileCap(8, l) <= tileCap(4, l) && tileCap(4, l) <= tileCap(2, l) && tileCap(2, l) <= tileCap(1, l));
  }
  assert.ok(tileCap(8, 2) < tileCap(8, 0));
  assert.equal(tileCap(1, 99), tileCap(1, 2));
});

const st = { open: 0.5, bright: 0.4, blink: 0, energy: 0.2, alpha: 1, glow: 0.8, level: 0 };
test('a quiet pumpkin with no flames is never redrawn', () => {
  const a = tileKey([], st, 384, false, 24, 1, 0, '#f80');
  const b = tileKey([], { ...st, open: 0.501 }, 384, false, 24, 99, 0, '#f80');
  assert.equal(keyChanged(a, b), false);
});
test('a visible change redraws, and so does the first frame', () => {
  const a = tileKey([], st, 384, false, 24, 1, 0, '#f80');
  assert.equal(keyChanged(undefined, a), true);
  for (const change of [{ open: 0.6 }, { blink: 0.5 }, { alpha: 0.5 }, { glow: 1.2 }, { level: 2 }])
    assert.equal(keyChanged(a, tileKey([], { ...st, ...change }, 384, false, 24, 1, 0, '#f80')), true, JSON.stringify(change));
  assert.equal(keyChanged(a, tileKey([], st, 512, false, 24, 1, 0, '#f80')), true);
  assert.equal(keyChanged(a, tileKey([], st, 384, false, 24, 1, 0, '#0f0')), true);
});
test('flames redraw at their own rate, not every frame', () => {
  let draws = 0, prev;
  for (let f = 0; f < 60; f++) {                   // one second at 60 frames a second
    const k = tileKey([], st, 384, true, 24, f / 60, 0, '#f80');
    if (keyChanged(prev, k)) draws++;
    prev = k;
  }
  assert.ok(draws >= 23 && draws <= 25, `drew ${draws} times`);
});
test('pumpkins do not all redraw their flames on the same frame', () => {
  const frames = new Set();
  for (let slot = 0; slot < 8; slot++) {
    let prev;
    for (let f = 0; f < 60; f++) {
      const k = tileKey([], st, 384, true, 24, f / 60, slot, '#f80');
      if (prev && keyChanged(prev, k)) frames.add(f);
      prev = k;
    }
  }
  assert.ok(frames.size > 30, `${frames.size} distinct frames`);
});
test('flame time is the rounded step', () => {
  const k = tileKey([], st, 384, true, 24, 1.003, 3, '#f80');
  assert.ok(Math.abs(flameTime(k[7], 24, 3) - 1.003) < 1 / 24);
  assert.equal(quant(0.5, 64), 32);
});

const run = (gov, ms, seconds, from = 0) => { let l = 0; for (let t = 0; t < seconds * 1000; t += ms) l = gov.update(ms, from + t); return l; };
test('governor steps down after a slow stretch, not before', () => {
  const g = new Governor();
  assert.equal(run(g, 40, 1.5), 0);
  assert.equal(run(g, 40, 2, 2000), 1);
});
test('governor ignores a short stall and a hidden tab', () => {
  const g = new Governor();
  for (let i = 0; i < 10; i++) g.update(16, i * 16);
  g.update(120, 200); g.update(5000, 5200);
  assert.equal(g.update(16, 5300), 0);
});
test('governor never goes below the last level or above full', () => {
  const g = new Governor();
  assert.equal(run(g, 60, 60), LEVELS.length - 1);
  assert.equal(run(g, 8, 600, 100000), 0);
});
test('governor settles instead of flipping back and forth', () => {
  // The heavy level only looks slow at full quality: at level 0 frames take 40 ms, at level 1 and up 14 ms.
  const g = new Governor();
  let level = 0, changes = 0, t = 0;
  for (; t < 300000; t += 16) {
    const next = g.update(level === 0 ? 40 : 14, t);
    if (next !== level) { changes++; level = next; }
  }
  assert.equal(level, 1);
  assert.ok(changes <= 7, `${changes} changes in 5 minutes`);
  const late = []; let l2 = level;
  for (let u = 0; u < 300000; u += 16) { const n = g.update(l2 === 0 ? 40 : 14, 300000 + u); if (n !== l2) { late.push(u); l2 = n; } }
  assert.ok(late.length <= 2, `${late.length} more changes in the next 5 minutes`);
});

test('quality setting: valid values kept, anything else becomes auto', () => {
  assert.equal(DEFAULTS.adv.quality, 'auto');
  assert.equal(ADV_DEFAULTS.quality, 'auto');
  assert.equal(sanitize({ adv: { quality: 'lite' } }).adv.quality, 'lite');
  assert.equal(sanitize({ adv: { quality: 'full' } }).adv.quality, 'full');
  assert.equal(sanitize({ adv: { quality: 'ultra' } }).adv.quality, 'auto');
  assert.equal(sanitize({ adv: { quality: 5 } }).adv.quality, 'auto');
  assert.equal(sanitize({ sens: 3 }).adv.quality, 'auto');          // saved by an older version
});

test('tileKey: a sad face is a different picture, and a tiny change in sadness is not', () => {
  const a = tileKey([], st, 384, false, 24, 1, 0, '#f80');
  assert.equal(keyChanged(a, tileKey([], { ...st, sad: 0.5 }, 384, false, 24, 1, 0, '#f80')), true);
  assert.equal(keyChanged(tileKey([], { ...st, sad: 0.5 }, 384, false, 24, 1, 0, '#f80'), tileKey([], { ...st, sad: 0.51 }, 384, false, 24, 1, 0, '#f80')), false);
});
