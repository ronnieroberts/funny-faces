// What the main screen shares with display screens: the pumpkins and look (rarely) and the mouths (often).
import { validatePack, FORMAT } from './facepack.js';
import { sanitize, sanitizeScreenOutput, MAX_PUMPKINS } from './settings.js';

/** epoch is a random number picked each time the main screen page loads; it tells screens to forget old counters.
 *  faceFor(key) gives the face object for a pumpkin's face key. Only the enabled pumpkins are sent. */
export function buildState(settings, faceFor, epoch = 0) {
  const on = settings.pumpkins.filter((p) => p.enabled), faces = {};
  for (const p of on) if (!faces[p.face]) faces[p.face] = faceFor(p.face);
  return {
    epoch, color: settings.color, glow: settings.glow, x: settings.x, y: settings.y, size: settings.size, idleDim: settings.adv.idleDim,
    pumpkins: on.map((p) => ({ face: p.face, quad: p.quad, color: p.color })), faces,
    screenOutput: sanitizeScreenOutput(settings.screenOutput),   // mirror / flip for every screen; this page's own `output` is never sent
  };
}

/** Validate what arrived from the server. Returns null for anything that is not a good state. */
export function parseState(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.pumpkins) || !obj.faces || typeof obj.faces !== 'object') return null;
  try {
    const faces = Object.create(null);   // no inherited keys: a face called 'toString' must not match
    for (const [key, f] of Object.entries(obj.faces).slice(0, MAX_PUMPKINS)) {
      faces[key] = validatePack({ format: FORMAT, version: 1, id: 'shared', name: 'Shared', faces: [f] }).faces[0];
    }
    const s = sanitize({ color: obj.color, glow: obj.glow, x: obj.x, y: obj.y, size: obj.size, adv: { idleDim: obj.idleDim },
      pumpkins: obj.pumpkins.slice(0, MAX_PUMPKINS).map((p) => ({ ...p, voice: 'full', enabled: true })) });
    const pumpkins = s.pumpkins.map((p, i) => ({ face: Object.hasOwn(faces, obj.pumpkins[i].face) ? faces[obj.pumpkins[i].face] : undefined, quad: p.quad, color: p.color }));   // quad: re-validated, or the default place if it was bad
    if (!pumpkins.length || pumpkins.some((p) => !p.face)) return null;
    const epoch = Number.isInteger(obj.epoch) && obj.epoch >= 0 && obj.epoch < 2 ** 31 ? obj.epoch : 0;
    return { epoch, color: s.color, glow: s.glow, x: s.x, y: s.y, size: s.size, idleDim: s.adv.idleDim, pumpkins, screenOutput: sanitizeScreenOutput(obj.screenOutput) };
  } catch { return null; }
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
/** One mouth per pumpkin, three bytes each. */
export const packMouth = (list) => list.flatMap((m) => [byte(m.open), byte(m.bright), byte(m.energy)]);

/** The binary mouth message (see docs/PROTOCOL.md): 0x4D, a 16 bit sequence number, then the packed bytes. */
export const MOUTH_TYPE = 0x4d;
export function mouthFrame(n, packed) {
  const f = new Uint8Array(3 + packed.length);
  f[0] = MOUTH_TYPE; f[1] = (n >> 8) & 255; f[2] = n & 255; f.set(packed, 3);
  return f;
}

/** A received binary message as {n, mouths}, or null when it is not a good mouth frame (1 to MAX_PUMPKINS pumpkins). */
export function parseMouth(data) {
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return null;
  const b = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (b[0] !== MOUTH_TYPE || b.length < 6 || b.length > 3 + 3 * MAX_PUMPKINS || b.length % 3) return null;
  const mouths = [];
  for (let i = 3; i < b.length; i += 3) mouths.push({ open: b[i] / 255, bright: b[i + 1] / 255, energy: b[i + 2] / 255 });
  return { n: (b[1] << 8) | b[2], mouths };
}

/** The 16 bit mouth sequence wraps: n is newer than last when it is 1 to 32767 steps ahead. last < 0 means nothing seen yet. */
export const isNewer16 = (n, last) => last < 0 || (((n - last) & 0xffff) > 0 && ((n - last) & 0xffff) < 0x8000);

/** Messages can arrive out of order; only accept a number higher than the last one used. */
export const isNewer = (n, last) => !Number.isInteger(n) || n > last;

/** Worth sending? Skip repeats so a quiet room costs nothing. */
export function changed(a, b) {
  return !a || a.length !== b.length || a.some((x, i) => Math.abs(x - b[i]) >= 2);
}
