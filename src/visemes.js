// Sound to mouth shape, in the browser, with no model. The letters are the nine shapes Rhubarb Lip Sync uses:
//   X rest   A closed (P B M)   B teeth, spread (EE, S, T)   C open (EH, AE)   D wide open (AA)
//   E rounded (AO, ER)   F puckered (OO, W)   G teeth on lip (F V)   H tongue up (L)
// The live classifier picks X A B C D E F from the spectrum. G and H need more than a spectrum, so only
// imported or offline tracks use them. Pure maths, no DOM, so it runs the same live and offline.
import { bandDbFromLin, clamp } from './response.js';

export const LETTERS = 'XABCDEFGH';

/** Final mouth look per shape: o = how far the jaw drops (0..1), wide = 0 puckered .. 1 spread. */
export const SHAPES = {
  X: { o: 0, wide: 0.5 },
  A: { o: 0, wide: 0.45 },
  B: { o: 0.22, wide: 0.95 },
  C: { o: 0.55, wide: 0.7 },
  D: { o: 1, wide: 0.5 },
  E: { o: 0.62, wide: 0.15 },
  F: { o: 0.3, wide: 0 },
  G: { o: 0.16, wide: 0.85 },
  H: { o: 0.5, wide: 0.45 },
};

/** The relay and the drawing code carry (open, bright); drawFace shrinks open by 0.45 * bright and bright = 1 - wide. */
export function shapeToMouth(letter, loud = 1) {
  const s = SHAPES[letter] || SHAPES.X;
  const bright = 1 - s.wide;
  const o = s.o * (0.55 + 0.45 * clamp(loud, 0, 1));
  return { open: clamp(o / (1 - 0.45 * bright), 0, 1), bright };
}

/** Power in [lo, hi] Hz, plus where the strongest smoothed peak sits (a rough formant). */
function peakIn(sm, binHz, lo, hi) {
  let best = -1, at = lo;
  for (let i = Math.max(1, Math.floor(lo / binHz)); i <= Math.min(sm.length - 1, Math.ceil(hi / binHz)); i++) {
    if (sm[i] > best) { best = sm[i]; at = i * binHz; }
  }
  return at;
}

/** Smooth a power spectrum with a triangular window about +-width Hz wide (wider than one voice harmonic). */
export function smooth(lin, binHz, width = 160) {
  const r = Math.max(1, Math.round(width / binHz)), out = new Float32Array(lin.length);
  for (let i = 0; i < lin.length; i++) {
    let s = 0, w = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= lin.length) continue;
      const wt = r + 1 - Math.abs(k);
      s += lin[j] * wt; w += wt;
    }
    out[i] = s / w;
  }
  return out;
}

/** Spectrum features that decide the shape. lin = linear power per FFT bin. */
export function features(lin, binHz) {
  const sm = smooth(lin, binHz);
  // pre-emphasis (power x f) so the strong low harmonics do not hide the second formant
  const em = new Float32Array(sm.length);
  for (let i = 0; i < sm.length; i++) em[i] = sm[i] * i * binHz;
  const f1 = peakIn(em, binHz, 250, 950);
  const f2 = peakIn(em, binHz, Math.max(900, f1 + 250), 2900);
  const low = Math.pow(10, bandDbFromLin(lin, binHz, 150, 3500) / 10);
  const high = Math.pow(10, bandDbFromLin(lin, binHz, 3500, 9000) / 10) * 2.6;   // wider band, so scale to match
  return { f1, f2, hiRatio: high / (low + high + 1e-20) };
}

/** Pick a shape letter from features. Call only when there is sound; silence is X or A. */
export function classify({ f1, f2, hiRatio }) {
  if (hiRatio > 0.6) return 'B';                          // s, sh, f, t: teeth showing
  if (f1 > 600) return f2 > 1500 ? 'C' : 'D';
  if (f1 > 420) return f2 > 1300 ? 'C' : 'E';
  if (f2 > 1700) return 'B';
  return f2 < 1100 ? 'F' : 'E';
}

/** Turns one frame at a time into a steady letter: waits for a new shape to repeat before switching. */
export class VisemeTracker {
  constructor() { this.letter = 'X'; this.cand = 'X'; this.n = 0; this.sinceSound = 9; }
  /** loud: 0..1 amplitude (the jaw value). Returns the letter to show. */
  update(lin, binHz, loud, dt) {
    let want;
    if (loud < 0.06) {
      this.sinceSound += dt;
      want = this.sinceSound < 0.18 ? 'A' : 'X';           // a short gap right after sound is a closed lip
    } else {
      this.sinceSound = 0;
      want = classify(features(lin, binHz));
    }
    if (want === this.letter) { this.cand = want; this.n = 0; return this.letter; }
    if (want === this.cand) this.n++; else { this.cand = want; this.n = 1; }
    const need = want === 'X' || want === 'A' ? 1 : 2;     // closing is instant, a new vowel must repeat once
    if (this.n >= need) { this.letter = want; this.n = 0; }
    return this.letter;
  }
}
