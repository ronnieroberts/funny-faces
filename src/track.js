// Mouth tracks: a whole song analysed once, in the browser, into one Rhubarb-style letter plus a loudness digit per
// frame (25 frames a second), so a four minute song is about 12 KB and plays back in sync with no live analysis.
// Pure maths (no DOM), same classifier as the live mouth.
import { powerSpectrum } from './fft.js';
import { bandDbFromLin, clamp } from './response.js';
import { classify, features } from './visemes.js';

export const FPS = 25;
const SIZE = 2048;                                       // FFT window; about 46 ms at 44.1 kHz
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/** samples: {mid, side?, sampleRate}. With centre = true the side channel is subtracted from the spectrum, which cuts
 *  wide stereo instruments and keeps what sits in the middle (usually the singer). Returns {v, fps, data}. */
export async function analyze({ mid, side = null, sampleRate }, { centre = false, gate = 0.35, onProgress } = {}) {
  const hop = Math.round(sampleRate / FPS), frames = Math.max(1, Math.floor(mid.length / hop)), binHz = sampleRate / SIZE;
  const specs = new Array(frames), db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * hop - (SIZE >> 1) + (hop >> 1);
    const lin = powerSpectrum(mid, Math.max(0, start), SIZE);
    if (centre && side) {
      const s = powerSpectrum(side, Math.max(0, start), SIZE);
      for (let i = 0; i < lin.length; i++) lin[i] = Math.max(lin[i] - s[i], lin[i] * 0.05);
    }
    specs[f] = lin;
    db[f] = bandDbFromLin(lin, binHz, 150, 3500);
    if (f % 400 === 399) { if (onProgress) onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  // Whole-song loudness: quiet floor and loud peak, so one pass needs no live tracking.
  const sorted = Float32Array.from(db).sort();
  const floor = percentile(sorted, 0.1), peak = Math.max(percentile(sorted, 0.97), floor + 14);
  const g = floor + gate * (peak - floor);
  const letters = [], level = [];
  let since = 9;
  for (let f = 0; f < frames; f++) {
    const loud = clamp((db[f] - g) / Math.max(peak - g, 1e-6), 0, 1);
    level.push(Math.round(loud * 9));
    if (loud < 0.06) { since += 1 / FPS; letters.push(since < 0.18 ? 'A' : 'X'); }
    else { since = 0; letters.push(classify(features(specs[f], binHz))); }
  }
  for (let f = 1; f < frames - 1; f++) {                  // a one-frame blip between two equal frames is noise
    if (letters[f] !== letters[f - 1] && letters[f - 1] === letters[f + 1] && letters[f] !== 'A') letters[f] = letters[f - 1];
  }
  return { v: 1, fps: FPS, data: letters.map((l, f) => l + level[f]).join('') };
}

/** Check a track that came from outside (a saved file, say). Returns the track or null. */
export function parseTrack(obj) {
  if (!obj || obj.v !== 1 || obj.fps !== FPS || typeof obj.data !== 'string') return null;
  if (obj.data.length % 2 || obj.data.length > 2 * FPS * 3600 * 3) return null;     // up to 3 hours
  return /^([XABCDEFGH][0-9])+$/.test(obj.data) ? { v: 1, fps: FPS, data: obj.data } : null;
}

/** The letter and loudness (0..1) at time t seconds. Past the end (or before the start) is rest. */
export function trackAt(track, t) {
  const f = Math.floor(t * track.fps), n = track.data.length / 2;
  if (!(f >= 0 && f < n)) return { letter: 'X', loud: 0 };
  return { letter: track.data[2 * f], loud: (track.data.charCodeAt(2 * f + 1) - 48) / 9 };
}

