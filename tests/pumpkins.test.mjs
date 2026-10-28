import test from 'node:test';
import assert from 'node:assert/strict';
import { Conductor } from '../src/conductor.js';
import { Mouths } from '../src/voice.js';
import { placeAll, placement } from '../src/layout.js';
import { DEFAULTS, defaultPumpkins, sanitize } from '../src/settings.js';

const seeded = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const opt = { mode: 'turns', turnPause: 0.35, breakIns: 0.5 };

/** Run a sound pattern: [seconds, loudness] steps at 30 frames a second; returns the weights at every frame. */
const clock = new WeakMap();
function run(c, steps, n, o) {
  const out = []; let t = clock.get(c) || 0;
  for (const [sec, level] of steps) for (let i = 0; i < sec * 30; i++, t += 1 / 30) out.push(c.update(t, level, n, o));
  clock.set(c, t);
  return out;
}
const speakers = (frames) => [...new Set(frames.filter((w) => w.some(Boolean)).map((w) => w.indexOf(1)))];

test('sync: every pumpkin moves together', () => {
  assert.deepEqual(new Conductor().update(0, 0.5, 3, { ...opt, mode: 'sync' }), [1, 1, 1]);
  assert.deepEqual(new Conductor().update(0, 0.5, 1, opt), [1]);
});

test('turns: each phrase after a silence goes to the next pumpkin', () => {
  const c = new Conductor();
  const lead = (frames) => frames.find((w) => w.some(Boolean)).indexOf(1);
  const a = run(c, [[1, 0.6], [1, 0]], 3, opt), b = run(c, [[1, 0.6], [1, 0]], 3, opt), d = run(c, [[1, 0.6]], 3, opt);
  assert.deepEqual([lead(a), lead(b), lead(d)], [0, 1, 2]);
  assert.equal(new Set(a.slice(0, 30).map((w) => w.join())).size, 1);          // one speaker for the whole phrase
});

test('turns: a short gap inside a phrase does not change the speaker', () => {
  const c = new Conductor();
  const f = run(c, [[0.5, 0.6], [0.2, 0], [0.5, 0.6]], 3, opt);
  assert.deepEqual(speakers(f), [0]);
});

test('random: a different pumpkin starts after each silence, others break in during a phrase', () => {
  const c = new Conductor(seeded());
  const lead = [];
  let breaks = 0;
  for (let k = 0; k < 6; k++) {
    const f = run(c, [[4, 0.6], [1, 0]], 4, { ...opt, mode: 'random', breakIns: 1 });
    lead.push(f.find((w) => w.some(Boolean)).indexOf(1));
    breaks += f.filter((w) => w.filter(Boolean).length > 1).length;
  }
  for (let i = 1; i < lead.length; i++) assert.notEqual(lead[i], lead[i - 1]);   // never the same speaker twice
  assert.ok(new Set(lead).size > 1);
  assert.ok(breaks > 0, 'someone should have broken in');
  const quiet = run(new Conductor(seeded()), [[3, 0]], 4, { ...opt, mode: 'random', breakIns: 1 });
  assert.ok(quiet.every((w) => w.every((x) => x === 0)));                         // nobody talks in silence
});

test('random with no break-ins keeps one speaker per phrase', () => {
  const f = run(new Conductor(seeded(3)), [[5, 0.6]], 4, { ...opt, mode: 'random', breakIns: 0 });
  assert.ok(f.every((w) => w.filter(Boolean).length === 1));
});

// ---- Mouths: spectra built from power at chosen frequencies
const BIN = 21.5;
const spectrum = (peaks) => { const lin = new Float32Array(1024).fill(1e-12); for (const [hz, p] of peaks) lin[Math.round(hz / BIN)] = p; return lin; };
const settings = (o = {}) => ({ ...DEFAULTS, ...o, adv: { ...DEFAULTS.adv, ...(o.adv || {}) } });
function drive(mouths, lin, s, pumpkins, frames = 40) {
  let out;
  for (let i = 0; i < frames; i++) out = mouths.update({ lin, binHz: BIN }, 0.033, i * 0.033, s, pumpkins);
  return out;
}

test('bands: a bass voice moves the bass pumpkin and not the soprano', () => {
  const ps = defaultPumpkins(4).map((p, i) => ({ ...p, voice: ['bass', 'soprano', 'full', 'treble'][i] }));
  const m = new Mouths(), s = settings({ mode: 'bands', pumpkins: ps });
  // quiet floor first so the loudness tracker has a baseline, then a loud low voice
  drive(m, spectrum([[100, 1e-9]]), s, ps, 30);
  const out = drive(m, spectrum([[100, 1e-3]]), s, ps, 20);
  assert.ok(out[0].open > 0.2, 'bass pumpkin opens');
  assert.ok(out[1].open < out[0].open / 2, 'soprano pumpkin stays much quieter');
  assert.ok(out[3].open < 0.1, 'treble pumpkin stays shut');
});

test('advanced settings: output sensitivity, noise gate and input sensitivity change the reaction', () => {
  const ps = [defaultPumpkins(1)[0]], loud = spectrum([[300, 1e-3], [900, 1e-3], [1800, 1e-4]]), floor = spectrum([[300, 1e-9]]);
  const peak = (adv) => { const m = new Mouths(), s = settings({ adv }); drive(m, floor, s, ps, 30); return drive(m, loud, s, ps, 25)[0].open; };
  const base = peak({});
  assert.ok(base > 0.2);
  assert.ok(peak({ outputGain: 0.4 }) < base * 0.5, 'lower output sensitivity opens the mouth less');
  assert.ok(peak({ outputGain: 2 }) >= base, 'higher output sensitivity opens it at least as wide');
  const m = new Mouths(), s = settings({ adv: { gate: 0.9 } });
  drive(m, floor, s, ps, 30);
  const quiet = drive(m, spectrum([[300, 1e-8]]), s, ps, 25)[0].open;
  assert.ok(quiet < 0.05, 'a high noise gate ignores quiet sound');
});

test('snappiness: a snappy mouth reaches a sound sooner than a slow one', () => {
  const ps = [defaultPumpkins(1)[0]], loud = spectrum([[300, 1e-3], [900, 1e-3]]);
  const reach = (snap) => { const m = new Mouths(), s = settings({ adv: { snap } }); drive(m, spectrum([[300, 1e-9]]), s, ps, 30); return drive(m, loud, s, ps, 3)[0].open; };
  assert.ok(reach(1) > reach(0));
});

test('voice focus: bass-heavy sound moves the mouth less', () => {
  const ps = [defaultPumpkins(1)[0]];
  const bass = spectrum([[60, 1e-1], [300, 1e-3], [900, 1e-3]]), floor = spectrum([[300, 1e-9]]);
  const at = (voiceFocus) => { const m = new Mouths(), s = settings({ adv: { voiceFocus } }); drive(m, floor, s, ps, 30); return drive(m, bass, s, ps, 25)[0].open; };
  assert.ok(at(1) <= at(0));
});

test('shape detail 0 gives plain open and close', () => {
  const ps = [defaultPumpkins(1)[0]], m = new Mouths(), s = settings({ adv: { shapeDetail: 0 } });
  drive(m, spectrum([[300, 1e-9]]), s, ps, 30);
  const o = drive(m, spectrum([[300, 1e-3], [900, 1e-3]]), s, ps, 25)[0];
  assert.ok(Math.abs(o.bright - 0.5) < 0.05);
});

test('turn-taking silences the pumpkins that are not speaking', () => {
  const ps = defaultPumpkins(3), m = new Mouths(), s = settings({ mode: 'turns' });
  drive(m, spectrum([[300, 1e-9]]), s, ps, 30);
  const out = drive(m, spectrum([[300, 1e-3], [900, 1e-3]]), s, ps, 25);
  assert.equal(out.filter((o) => o.open > 0.2).length, 1);
});

// ---- layout
test('one pumpkin sits exactly where a single face always did', () => {
  const [p] = placeAll(1920, 1080, { x: 0, y: 0, size: 0.8 }, [{ dx: 0, dy: 0, scale: 1 }]), q = placement(1920, 1080, { x: 0, y: 0, size: 0.8 });
  assert.deepEqual(p, q);
});

test('up to four pumpkins in a row, more in two rows, all inside the window', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const spots = placeAll(1920, 1080, { x: 0, y: 0, size: 1 }, Array.from({ length: n }, () => ({ dx: 0, dy: 0, scale: 1 })));
    assert.equal(spots.length, n);
    for (const p of spots) assert.ok(p.left >= -1 && p.top >= -1 && p.left + p.s <= 1921 && p.top + p.s <= 1081, `n=${n}`);
    const rows = new Set(spots.map((p) => Math.round(p.top))).size;
    assert.equal(rows, n > 4 ? 2 : 1);
  }
});

test('nudging one pumpkin moves only that one', () => {
  const base = Array.from({ length: 3 }, () => ({ dx: 0, dy: 0, scale: 1 }));
  const moved = base.map((p, i) => (i === 1 ? { ...p, dx: 0.5 } : p));
  const a = placeAll(1920, 1080, DEFAULTS, base), b = placeAll(1920, 1080, DEFAULTS, moved);
  assert.deepEqual(a[0], b[0]); assert.notEqual(a[1].left, b[1].left); assert.deepEqual(a[2], b[2]);
});

test('defaults: one pumpkin for new users; eight different faces and voices available', () => {
  assert.equal(sanitize(null).pumpkins.length, 1);
  assert.equal(defaultPumpkins(8).length, 8);
  assert.ok(new Set(defaultPumpkins(8).map((p) => p.voice)).size >= 6);
});
