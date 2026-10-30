// Everything is kept in this browser only. Nothing is sent anywhere.
import { gridQuads, sanitizeQuad } from './quad.js';
import { QUALITY_SETTINGS } from './quality.js';
const KEY = 'face-characters.settings.v1';
export const MAX_PUMPKINS = 8;
export const MODES = ['sync', 'bands', 'turns', 'random'];
/** Voice bands a pumpkin can listen to (full = the whole speech range). */
export const VOICE_NAMES = { full: 'Full range', bass: 'Bass', baritone: 'Baritone', tenor: 'Tenor', alto: 'Alto', soprano: 'Soprano', treble: 'Treble and "s" sounds' };
const DEFAULT_VOICES = ['bass', 'tenor', 'alto', 'soprano', 'baritone', 'treble', 'full', 'full'];
const DEFAULT_FACES = ['starter/classic', 'starter/round', 'starter/cat', 'starter/angry', 'starter/skull', 'starter/grin', 'starter/classic', 'starter/round'];

export const ADV_DEFAULTS = { inputDb: 0, outputGain: 1, gate: 0.35, snap: 0.6, voiceFocus: 0.3, shapeDetail: 1, idleDim: 0.5, quality: 'auto' };

/** Aspect (width / height) the default quads are made for when the real window is not known. */
export const DEFAULT_ASPECT = 16 / 9;
const GROUP = { x: 0, y: 0, size: 0.8 };

/** quad: corners TL, TR, BR, BL as fractions of the stage (see quad.js). */
export function newPumpkin(i = 0, A = DEFAULT_ASPECT) {
  return { face: DEFAULT_FACES[i % 8], voice: 'full', trim: 0, enabled: true, quad: gridQuads(1, A, GROUP)[0], color: '' };
}
export const defaultPumpkins = (n, A = DEFAULT_ASPECT) => {
  const quads = gridQuads(n, A, GROUP);
  return Array.from({ length: n }, (_, i) => ({ ...newPumpkin(i, A), quad: quads[i], voice: n > 1 ? DEFAULT_VOICES[i % 8] : 'full' }));
};
/** Put every pumpkin back in the default row or grid (keeps faces and everything else). The group x, y and size place it. */
export function arrange(pumpkins, A = DEFAULT_ASPECT, group = GROUP) {
  const quads = gridQuads(pumpkins.length, A, group);
  return pumpkins.map((p, i) => ({ ...p, quad: quads[i] }));
}

export const DEFAULTS = {
  color: '#ff8a1f', glow: 0.8, x: 0, y: 0, size: 0.8,
  mode: 'sync', turnPause: 0.35, breakIns: 0.4,
  adv: { ...ADV_DEFAULTS },
  pumpkins: [newPumpkin(0)],
  output: { mirror: false, flip: false, keepAwake: true },   // per device: never shared with display screens
  screenOutput: { mirror: false, flip: false },              // set here, sent to every connected screen (on top of each screen's own)
};

const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '');

function pumpkin(o, i, quad) {
  const d = newPumpkin(i), p = o && typeof o === 'object' ? o : {};
  return {
    face: typeof p.face === 'string' && p.face.length <= 130 ? p.face : d.face,
    voice: Object.hasOwn(VOICE_NAMES, p.voice) ? p.voice : d.voice,
    trim: num(p.trim, -20, 20, 0), enabled: p.enabled !== false,
    quad, color: color(p.color),
  };
}

/** Output options for this device: mirror (rear projection), flip (projector upside down), keep the screen awake. */
export function sanitizeOutput(o) {
  const v = o && typeof o === 'object' ? o : {};
  return { mirror: v.mirror === true, flip: v.flip === true, keepAwake: v.keepAwake !== false };
}

/** What this page tells every connected screen: mirror and flip. */
export function sanitizeScreenOutput(o) {
  const v = o && typeof o === 'object' ? o : {};
  return { mirror: v.mirror === true, flip: v.flip === true };
}

/** A is the stage's width / height; it only matters for pumpkins that have no quad yet. */
export function sanitize(o, A = DEFAULT_ASPECT) {
  const s = structuredClone(DEFAULTS);
  if (!o || typeof o !== 'object') return s;
  s.color = color(o.color) || DEFAULTS.color;
  s.glow = num(o.glow, 0, 2, DEFAULTS.glow);
  s.x = num(o.x, -1, 1, 0); s.y = num(o.y, -1, 1, 0); s.size = num(o.size, 0.1, 3, DEFAULTS.size);
  if (MODES.includes(o.mode)) s.mode = o.mode;
  s.turnPause = num(o.turnPause, 0.1, 3, DEFAULTS.turnPause);
  s.breakIns = num(o.breakIns, 0, 1, DEFAULTS.breakIns);
  const a = o.adv && typeof o.adv === 'object' ? o.adv : {};
  s.adv = {
    inputDb: num(a.inputDb ?? o.sens, -30, 30, 0),                 // o.sens and o.gate: older saved settings, migrated here
    outputGain: num(a.outputGain, 0.4, 2, 1), gate: num(a.gate ?? o.gate, 0, 0.9, ADV_DEFAULTS.gate),
    snap: num(a.snap, 0, 1, ADV_DEFAULTS.snap), voiceFocus: num(a.voiceFocus, 0, 1, ADV_DEFAULTS.voiceFocus),
    shapeDetail: num(a.shapeDetail, 0, 1, 1), idleDim: num(a.idleDim, 0, 1, ADV_DEFAULTS.idleDim),
    quality: QUALITY_SETTINGS.includes(a.quality) ? a.quality : 'auto',   // settings saved before this have none: Auto
  };
  s.output = sanitizeOutput(o.output);
  s.screenOutput = sanitizeScreenOutput(o.screenOutput);
  const list = Array.isArray(o.pumpkins) ? o.pumpkins.slice(0, MAX_PUMPKINS) : [];
  const src = list.length ? list : [{ face: typeof o.face === 'string' ? o.face : undefined }];
  // Settings saved before quads: place them from the group x, y, size and each pumpkin's old dx, dy, scale.
  const adj = src.map((p) => ({ dx: num(p && p.dx, -2, 2, 0), dy: num(p && p.dy, -2, 2, 0), scale: num(p && p.scale, 0.2, 3, 1) }));
  const grid = gridQuads(src.length, A, s, adj);
  s.pumpkins = src.map((p, i) => pumpkin(p, i, sanitizeQuad(p && p.quad, A) || grid[i]));
  return s;
}

/** Make the list n long. Faces already there keep everything (quad, skew, size, face, voice); removing drops the last ones.
 *  Only new faces are placed: in their slot of the default row for the new count. To line everything up, call arrange(). */
export function resize(pumpkins, n, A = DEFAULT_ASPECT, group = GROUP) {
  n = Math.max(1, Math.min(MAX_PUMPKINS, Math.round(n)));
  const kept = pumpkins.slice(0, n);
  if (kept.length >= n) return kept;
  const base = defaultPumpkins(Math.max(n, 2), A), slots = gridQuads(n, A, group);
  return [...kept, ...Array.from({ length: n - kept.length }, (_, k) => ({ ...base[kept.length + k], quad: slots[kept.length + k] }))];
}

export function load(storage = globalThis.localStorage, A = DEFAULT_ASPECT) {
  try { return sanitize(JSON.parse(storage.getItem(KEY)), A); } catch { return sanitize(null, A); }
}

export function save(s, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(sanitize(s))); } catch { /* private mode: just forget */ }
}
