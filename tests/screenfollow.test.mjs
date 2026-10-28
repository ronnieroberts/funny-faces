import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollow, SILENCE_MS } from '../src/screenfollow.js';

const m = (open, energy = open) => ({ open, bright: 0.5, energy });
const frame = (n, ...mouths) => ({ n, mouths });
// Advance the screen by ms in 16 ms steps; returns the last mouths drawn.
function run(f, from, ms, send) {
  let out = [], t = from;
  for (; t < from + ms; t += 16) { if (send) send(t); out = f.tick(0.016, t); }
  return out;
}
const open = (out) => Math.max(...out.map((x) => x.open));

test('a frame opens the mouth, eased rather than jumped', () => {
  const f = createFollow();
  f.apply(frame(1, m(1)), 0);
  const first = f.tick(0.016, 16);
  assert.ok(first[0].open > 0.9);                                       // the first frame is shown directly
  f.apply(frame(2, m(0)), 20);
  const next = f.tick(0.016, 36);
  assert.ok(next[0].open > 0 && next[0].open < 1);
});

test('admin_gone eases the mouths closed and nothing reopens them', () => {
  const f = createFollow();
  f.apply(frame(1, m(1), m(0.8)), 0);
  run(f, 0, 200);
  f.adminGone();
  const out = run(f, 200, 600);
  assert.ok(open(out) < 0.01);
  assert.ok(out.every((x) => x.energy < 0.01));
  assert.equal(out.length, 2);                                          // still two pumpkins, just closed
});

test('with no frames for the silence timeout, a mouth that was open closes', () => {
  const f = createFollow();
  f.apply(frame(1, m(1)), 0);
  assert.ok(open(run(f, 0, SILENCE_MS - 100)) > 0.9);                   // still held just before the timeout
  assert.ok(open(run(f, SILENCE_MS - 100, 800)) < 0.01);
});

test('a held vowel stays open while keepalive frames arrive', () => {
  const f = createFollow();
  let n = 0, next = 0;
  const out = run(f, 0, 10000, (t) => { if (t >= next) { f.apply(frame(n++, m(0.9)), t); next = t + 400; } });
  assert.ok(open(out) > 0.85);
});

test('a quiet mouth that stays quiet is left alone', () => {
  const f = createFollow();
  f.apply(frame(1, m(0)), 0);
  assert.equal(open(run(f, 0, 5000)), 0);
});

test('admin_back resumes: new frames open the mouth again', () => {
  const f = createFollow();
  f.apply(frame(1, m(1)), 0);
  f.adminGone();
  assert.ok(open(run(f, 0, 600)) < 0.01);
  f.adminBack();
  assert.ok(open(run(f, 600, 300)) < 0.01);                             // back, but nothing to say yet: still closed
  f.apply(frame(2, m(0.7)), 900);
  assert.ok(open(run(f, 900, 300)) > 0.65);
  assert.ok(open(run(f, 1200, SILENCE_MS - 400)) > 0.65);              // the silence clock restarted with the frame
});

test('older sequence numbers are ignored, including across the 16 bit wrap', () => {
  const f = createFollow();
  assert.equal(f.apply(frame(10, m(1)), 0), true);
  assert.equal(f.apply(frame(10, m(0)), 1), false);                    // a duplicate
  assert.equal(f.apply(frame(9, m(0)), 2), false);
  assert.ok(open(run(f, 2, 100)) > 0.9);
  const w = createFollow();
  assert.equal(w.apply(frame(65534, m(0.2)), 0), true);
  assert.equal(w.apply(frame(65535, m(0.4)), 1), true);
  assert.equal(w.apply(frame(0, m(0.6)), 2), true);                    // wrapped, and newer
  assert.equal(w.apply(frame(1, m(0.8)), 3), true);
  assert.equal(w.apply(frame(65535, m(0)), 4), false);                 // a late one from before the wrap
  assert.ok(Math.abs(open(run(w, 4, 400)) - 0.8) < 0.01);
});

test('reset forgets the sequence, for a control page that started over', () => {
  const f = createFollow();
  f.apply(frame(500, m(1)), 0);
  assert.equal(f.apply(frame(0, m(0.5)), 1), false);
  f.reset();
  assert.equal(f.apply(frame(0, m(0.5)), 2), true);
});

test('a frame while the controller is marked gone means it is there after all', () => {
  const f = createFollow();
  f.adminGone();
  f.apply(frame(1, m(1)), 0);
  assert.ok(open(run(f, 0, 200)) > 0.9);
});
