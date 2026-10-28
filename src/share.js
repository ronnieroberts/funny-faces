// What the main screen shares with display screens: the pumpkins and look (rarely) and the mouths (often).
import { validatePack, FORMAT } from './facepack.js';
import { sanitize, MAX_PUMPKINS } from './settings.js';

/** epoch is a random number picked each time the main screen page loads; it tells screens to forget old counters.
 *  faceFor(key) gives the face object for a pumpkin's face key. Only the enabled pumpkins are sent. */
export function buildState(settings, faceFor, epoch = 0) {
  const on = settings.pumpkins.filter((p) => p.enabled), faces = {};
  for (const p of on) if (!faces[p.face]) faces[p.face] = faceFor(p.face);
  return {
    epoch, color: settings.color, glow: settings.glow, x: settings.x, y: settings.y, size: settings.size, idleDim: settings.adv.idleDim,
    pumpkins: on.map((p) => ({ face: p.face, quad: p.quad, color: p.color })), faces,
  };
}

/** Validate what arrived from the server. Returns null for anything that is not a good state. */
export function parseState(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.pumpkins) || !obj.faces || typeof obj.faces !== 'object') return null;
  try {
    const faces = {};
    for (const [key, f] of Object.entries(obj.faces).slice(0, MAX_PUMPKINS)) {
      faces[key] = validatePack({ format: FORMAT, version: 1, id: 'shared', name: 'Shared', faces: [f] }).faces[0];
    }
    const s = sanitize({ color: obj.color, glow: obj.glow, x: obj.x, y: obj.y, size: obj.size, adv: { idleDim: obj.idleDim },
      pumpkins: obj.pumpkins.slice(0, MAX_PUMPKINS).map((p) => ({ ...p, voice: 'full', enabled: true })) });
    const pumpkins = s.pumpkins.map((p, i) => ({ face: faces[obj.pumpkins[i].face], quad: p.quad, color: p.color }));   // quad: re-validated, or the default place if it was bad
    if (!pumpkins.length || pumpkins.some((p) => !p.face)) return null;
    const epoch = Number.isInteger(obj.epoch) && obj.epoch >= 0 && obj.epoch < 2 ** 31 ? obj.epoch : 0;
    return { epoch, color: s.color, glow: s.glow, x: s.x, y: s.y, size: s.size, idleDim: s.adv.idleDim, pumpkins };
  } catch { return null; }
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
/** One mouth per pumpkin, three bytes each. */
export const packMouth = (list) => list.flatMap((m) => [byte(m.open), byte(m.bright), byte(m.energy)]);

export function unpackMouth(v) {
  if (!Array.isArray(v) || !v.length || v.length % 3 || v.length > 3 * MAX_PUMPKINS || !v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return null;
  const out = [];
  for (let i = 0; i < v.length; i += 3) out.push({ open: v[i] / 255, bright: v[i + 1] / 255, energy: v[i + 2] / 255 });
  return out;
}

/** Messages can arrive out of order; only accept a number higher than the last one used. */
export const isNewer = (n, last) => !Number.isInteger(n) || n > last;

/** Worth sending? Skip repeats so a quiet room costs nothing. */
export function changed(a, b) {
  return !a || a.length !== b.length || a.some((x, i) => Math.abs(x - b[i]) >= 2);
}
