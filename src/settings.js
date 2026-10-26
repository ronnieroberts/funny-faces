// Everything is kept in this browser only. Nothing is sent anywhere.
const KEY = 'face-characters.settings.v1';
export const DEFAULTS = { face: 'classic', color: '#ff8a1f', glow: 0.8, sens: 0, gate: 0.35 };

export function sanitize(o) {
  const s = { ...DEFAULTS };
  if (!o || typeof o !== 'object') return s;
  if (typeof o.face === 'string' && o.face.length <= 64) s.face = o.face;
  if (typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)) s.color = o.color;
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  s.glow = num(o.glow, 0, 2, DEFAULTS.glow);
  s.sens = num(o.sens, -20, 20, DEFAULTS.sens);
  s.gate = num(o.gate, 0, 0.9, DEFAULTS.gate);
  return s;
}

export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch { return { ...DEFAULTS }; }
}

export function save(s, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(sanitize(s))); } catch { /* private mode: just forget */ }
}
