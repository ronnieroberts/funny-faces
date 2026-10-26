// What the main screen shares with display screens: the character and look (rarely) and the mouth (often).
import { validatePack, FORMAT } from './facepack.js';
import { sanitize } from './settings.js';

/** epoch is a random number picked each time the main screen page loads; it tells screens to forget old counters. */
export function buildState(settings, face, epoch = 0) {
  return { face, epoch, color: settings.color, glow: settings.glow, x: settings.x, y: settings.y, size: settings.size };
}

/** Validate what arrived from the relay. Returns null for anything that is not a good state. */
export function parseState(obj) {
  if (!obj || typeof obj !== 'object') return null;
  try {
    const pack = validatePack({ format: FORMAT, version: 1, id: 'shared', name: 'Shared', faces: [obj.face] });
    const s = sanitize({ color: obj.color, glow: obj.glow, x: obj.x, y: obj.y, size: obj.size });
    const epoch = Number.isInteger(obj.epoch) && obj.epoch >= 0 && obj.epoch < 2 ** 31 ? obj.epoch : 0;
    return { face: pack.faces[0], epoch, color: s.color, glow: s.glow, x: s.x, y: s.y, size: s.size };
  } catch { return null; }
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
export const packMouth = (m) => [byte(m.open), byte(m.bright), byte(m.energy)];

export function unpackMouth(v) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return null;
  return { open: v[0] / 255, bright: v[1] / 255, energy: v[2] / 255 };
}

/** Messages can arrive out of order; only accept a number higher than the last one used. */
export const isNewer = (n, last) => !Number.isInteger(n) || n > last;

/** Worth sending? Skip repeats so a quiet room costs nothing. */
export function changed(a, b) {
  return !a || a.some((x, i) => Math.abs(x - b[i]) >= 2);
}
