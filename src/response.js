// Pure response maths (no DOM). Shared by the live engine and, as a Python
// port, by the offline analyser (worker/faces_analysis/response.py).

export const FFT_SIZE = 2048;
export const DB_FLOOR = -140;   // live engine clamps analyser dB here

/** Voice ranges in Hz used for the mouth-track bands. */
export const VOICE_RANGES = {
  full: { lo: 80, hi: 8000 },
  bass: { lo: 60, hi: 250 },
  baritone: { lo: 90, hi: 400 },
  tenor: { lo: 130, hi: 520 },
  alto: { lo: 175, hi: 800 },
  soprano: { lo: 260, hi: 1100 },
  treble: { lo: 2500, hi: 8000 },
};
export const BRIGHT_LOW = { lo: 150, hi: 1200 };
export const BRIGHT_HIGH = { lo: 2500, hi: 7500 };

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Mean linear power over bins covering [lo, hi] Hz, in dB. */
export function bandDbFromLin(lin, binHz, lo, hi) {
  const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(lin.length - 1, Math.ceil(hi / binHz));
  let sum = 0;
  for (let i = a; i <= b; i++) sum += lin[i];
  return 10 * Math.log10(sum / Math.max(1, b - a + 1) + 1e-14);
}

/** High / low balance 0..1. */
export function brightnessFromLin(lin, binHz) {
  const lo = Math.pow(10, bandDbFromLin(lin, binHz, BRIGHT_LOW.lo, BRIGHT_LOW.hi) / 10);
  const hi = Math.pow(10, bandDbFromLin(lin, binHz, BRIGHT_HIGH.lo, BRIGHT_HIGH.hi) / 10);
  return hi / (lo + hi + 1e-20);
}

/** Adaptive floor/peak tracker and jaw smoother. */
export class Voice {
  constructor() { this.floor = -100; this.peak = -60; this.jaw = 0; this.raw = 0; }
  update(db, dt, gate, snap, sens) {
    db += sens;
    this.floor = db < this.floor ? db : this.floor + 1.5 * dt;
    this.peak = db > this.peak ? db : this.peak - 3 * dt;
    this.peak = Math.max(this.peak, this.floor + 14);
    const g = this.floor + gate * (this.peak - this.floor);
    const o = clamp((db - g) / Math.max(this.peak - g, 1e-6), 0, 1);
    const atk = 0.4 + 0.55 * snap, rel = 0.15 + 0.4 * snap, k = dt * 30;
    this.jaw += (o - this.jaw) * Math.min(1, (o > this.jaw ? atk : rel) * k);
    this.raw = o;
    return o;
  }
}
