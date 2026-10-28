import test from 'node:test';
import assert from 'node:assert/strict';
import { powerSpectrum } from '../src/fft.js';
import { features, classify, shapeToMouth, VisemeTracker, LETTERS } from '../src/visemes.js';

const SR = 44100, N = 2048;

/** Source-filter vowel: a pulse train at f0 through resonators at the formants. */
function vowel(formants, f0 = 130, seconds = 0.2) {
  const n = Math.round(SR * seconds), x = new Float32Array(n), period = Math.round(SR / f0);
  for (let i = 0; i < n; i += period) x[i] = 1;
  let y = x;
  for (const [f, bw] of formants) {
    const r = Math.exp((-Math.PI * bw) / SR), c = 2 * r * Math.cos((2 * Math.PI * f) / SR), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = y[i] + c * (out[i - 1] || 0) - r * r * (out[i - 2] || 0);
    y = out;
  }
  return y;
}
const letterOf = (s) => classify(features(powerSpectrum(s, 4000, N), SR / N));

const VOWELS = {   // textbook formants (Hz), male voice
  aa: [[730, 90], [1090, 110], [2440, 160]], ae: [[660, 90], [1720, 110], [2410, 160]],
  eh: [[530, 80], [1840, 110], [2480, 160]], ee: [[270, 60], [2290, 110], [3010, 160]],
  oo: [[300, 60], [870, 90], [2240, 160]], ao: [[570, 80], [840, 90], [2410, 160]],
};
const EXPECT = { aa: 'D', ae: 'C', eh: 'C', ee: 'B', oo: 'F', ao: 'E' };

for (const f0 of [110, 180]) {
  for (const [name, fm] of Object.entries(VOWELS)) {
    test(`vowel ${name} at ${f0} Hz maps to ${EXPECT[name]}`, () => {
      assert.equal(letterOf(vowel(fm, f0)), EXPECT[name]);
    });
  }
}

test('hissing noise shows teeth (B)', () => {
  const n = SR / 5, s = new Float32Array(n);
  let seed = 1;
  for (let i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; s[i] = (seed / 2 ** 32 - 0.5); }
  const hp = s.map((v, i) => v - (s[i - 1] || 0));   // crude high-pass: emphasise highs
  assert.equal(letterOf(hp), 'B');
});

test('every letter has a drawable mouth', () => {
  for (const l of LETTERS) {
    const m = shapeToMouth(l, 1);
    assert.ok(m.open >= 0 && m.open <= 1 && m.bright >= 0 && m.bright <= 1, l);
  }
  assert.equal(shapeToMouth('A').open, 0);
  assert.ok(shapeToMouth('D').open > shapeToMouth('C').open && shapeToMouth('C').open > shapeToMouth('B').open);
  assert.ok(shapeToMouth('F').bright > shapeToMouth('B').bright);   // puckered is narrow, teeth are wide
});

test('tracker: closes instantly, needs a repeat to change vowel, A right after sound then X', () => {
  const spec = powerSpectrum(vowel(VOWELS.aa), 4000, N), t = new VisemeTracker();
  assert.equal(t.update(spec, SR / N, 0.8, 0.033), 'X');   // first sighting is not enough
  assert.equal(t.update(spec, SR / N, 0.8, 0.033), 'D');
  assert.equal(t.update(spec, SR / N, 0, 0.033), 'A');
  for (let i = 0; i < 8; i++) t.update(spec, SR / N, 0, 0.033);
  assert.equal(t.letter, 'X');
});
