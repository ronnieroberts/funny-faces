// Everything is kept in this browser only. Nothing is sent anywhere.
const KEY = 'face-characters.settings.v1';
export const MAX_PUMPKINS = 8;
export const MODES = ['sync', 'bands', 'turns', 'random'];
/** Voice bands a pumpkin can listen to (full = the whole speech range). */
export const VOICE_NAMES = { full: 'Full range', bass: 'Bass', baritone: 'Baritone', tenor: 'Tenor', alto: 'Alto', soprano: 'Soprano', treble: 'Treble and "s" sounds' };
const DEFAULT_VOICES = ['bass', 'tenor', 'alto', 'soprano', 'baritone', 'treble', 'full', 'full'];
const DEFAULT_FACES = ['starter/classic', 'starter/round', 'starter/cat', 'starter/angry', 'starter/skull', 'starter/grin', 'starter/classic', 'starter/round'];

export const ADV_DEFAULTS = { inputDb: 0, outputGain: 1, gate: 0.35, snap: 0.6, voiceFocus: 0.3, shapeDetail: 1, idleDim: 0.5 };

export function newPumpkin(i = 0) {
  return { face: DEFAULT_FACES[i % 8], voice: 'full', trim: 0, enabled: true, dx: 0, dy: 0, scale: 1, color: '' };
}
export const defaultPumpkins = (n) => Array.from({ length: n }, (_, i) => ({ ...newPumpkin(i), voice: n > 1 ? DEFAULT_VOICES[i % 8] : 'full' }));

export const DEFAULTS = {
  color: '#ff8a1f', glow: 0.8, x: 0, y: 0, size: 0.8,
  mode: 'sync', turnPause: 0.35, breakIns: 0.4,
  adv: { ...ADV_DEFAULTS },
  pumpkins: [newPumpkin(0)],
  output: { mirror: false, flip: false, keepAwake: true },   // per device: never shared with display screens
};

const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '');

function pumpkin(o, i) {
  const d = newPumpkin(i), p = o && typeof o === 'object' ? o : {};
  return {
    face: typeof p.face === 'string' && p.face.length <= 130 ? p.face : d.face,
    voice: Object.hasOwn(VOICE_NAMES, p.voice) ? p.voice : d.voice,
    trim: num(p.trim, -20, 20, 0), enabled: p.enabled !== false,
    dx: num(p.dx, -2, 2, 0), dy: num(p.dy, -2, 2, 0), scale: num(p.scale, 0.2, 3, 1), color: color(p.color),
  };
}

/** Output options for this device: mirror (rear projection), flip (projector upside down), keep the screen awake. */
export function sanitizeOutput(o) {
  const v = o && typeof o === 'object' ? o : {};
  return { mirror: v.mirror === true, flip: v.flip === true, keepAwake: v.keepAwake !== false };
}

export function sanitize(o) {
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
    inputDb: num(a.inputDb ?? o.sens, -30, 30, 0),                 // o.sens and o.gate: settings saved before 1.0.2
    outputGain: num(a.outputGain, 0.4, 2, 1), gate: num(a.gate ?? o.gate, 0, 0.9, ADV_DEFAULTS.gate),
    snap: num(a.snap, 0, 1, ADV_DEFAULTS.snap), voiceFocus: num(a.voiceFocus, 0, 1, ADV_DEFAULTS.voiceFocus),
    shapeDetail: num(a.shapeDetail, 0, 1, 1), idleDim: num(a.idleDim, 0, 1, ADV_DEFAULTS.idleDim),
  };
  s.output = sanitizeOutput(o.output);
  const list = Array.isArray(o.pumpkins) ? o.pumpkins.slice(0, MAX_PUMPKINS) : [];
  s.pumpkins = list.length ? list.map(pumpkin) : [pumpkin({ face: typeof o.face === 'string' ? o.face : undefined }, 0)];
  return s;
}

/** Make the list n long, keeping what is there and adding sensible new ones. */
export function resize(pumpkins, n) {
  n = Math.max(1, Math.min(MAX_PUMPKINS, Math.round(n)));
  const base = defaultPumpkins(Math.max(n, 2));
  return Array.from({ length: n }, (_, i) => pumpkins[i] || base[i]);
}

export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch { return sanitize(null); }
}

export function save(s, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(sanitize(s))); } catch { /* private mode: just forget */ }
}
