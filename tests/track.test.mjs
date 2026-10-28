import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, parseTrack, trackAt, FPS } from '../src/track.js';
import { TrackVoice } from '../src/voice.js';

const SR = 22050;
function vowel(formants, f0, n) {
  const x = new Float32Array(n), period = Math.round(SR / f0);
  for (let i = 0; i < n; i += period) x[i] = 1;
  let y = x;
  for (const [f, bw] of formants) {
    const r = Math.exp((-Math.PI * bw) / SR), c = 2 * r * Math.cos((2 * Math.PI * f) / SR), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = y[i] + c * (out[i - 1] || 0) - r * r * (out[i - 2] || 0);
    y = out;
  }
  const peak = Math.max(...y.map(Math.abs)) || 1;
  return y.map((v) => v / peak * 0.5);
}
const AA = [[730, 90], [1090, 110], [2440, 160]], EE = [[270, 60], [2290, 110], [3010, 160]];
const seg = (formants, seconds) => vowel(formants, 130, Math.round(SR * seconds));
const silence = (seconds) => new Float32Array(Math.round(SR * seconds));
const join = (parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

test('a song of vowels and silence becomes the right letters at 25 frames a second', async () => {
  const mid = join([silence(0.5), seg(AA, 0.6), silence(0.5), seg(EE, 0.6), silence(0.5)]);
  const t = await analyze({ mid, sampleRate: SR });
  assert.equal(t.fps, FPS);
  assert.equal(t.data.length, 2 * Math.floor(mid.length / Math.round(SR / FPS)));
  assert.equal(trackAt(t, 0.25).letter, 'X');
  assert.equal(trackAt(t, 0.8).letter, 'D');
  assert.ok(trackAt(t, 0.8).loud > 0.3);
  assert.equal(trackAt(t, 1.4).letter === 'A' || trackAt(t, 1.4).letter === 'X', true);
  assert.equal(trackAt(t, 1.9).letter, 'B');
  assert.equal(trackAt(t, 99).letter, 'X');
  assert.equal(trackAt(t, -1).letter, 'X');
});

test('centre option keeps the middle and cuts side noise', async () => {
  const v = join([silence(0.3), seg(AA, 0.8), silence(0.3)]);
  let s = 7;
  const side = Float32Array.from(v, () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 2 ** 32 - 0.5) * 0.8; });
  const mid = v;
  const t = await analyze({ mid, side, sampleRate: SR }, { centre: true });
  assert.equal(trackAt(t, 0.7).letter, 'D');
});

test('saved tracks are validated', async () => {
  const t = await analyze({ mid: seg(AA, 0.5), sampleRate: SR });
  assert.deepEqual(parseTrack(JSON.parse(JSON.stringify(t))), t);
  assert.equal(parseTrack({ ...t, data: t.data + 'Z1' }), null);
  assert.equal(parseTrack({ ...t, fps: 30 }), null);
  assert.equal(parseTrack(null), null);
});

test('TrackVoice follows the clock and closes when the clock passes the end', async () => {
  const t = await analyze({ mid: join([silence(0.3), seg(AA, 0.8)]), sampleRate: SR });
  let now = 0.8;
  const v = new TrackVoice(t, () => now);
  let m;
  for (let i = 0; i < 10; i++) m = v.update(0.033);
  assert.equal(m.shape, 'D');
  assert.ok(m.open > 0.5);
  now = 50;
  for (let i = 0; i < 20; i++) m = v.update(0.033);
  assert.ok(m.open < 0.05);
});
