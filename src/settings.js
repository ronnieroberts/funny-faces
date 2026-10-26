// Everything is kept in this browser only. Nothing is sent anywhere.
const KEY = 'face-characters.settings.v1';
export const DEFAULTS = { face: 'starter/classic', color: '#ff8a1f', glow: 0.8, sens: 0, gate: 0.35, x: 0, y: 0, size: 0.8 };

export function sanitize(o) {
  const s = { ...DEFAULTS };
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  if (!o || typeof o !== 'object') return s;
  if (typeof o.face === 'string' && o.face.length <= 130) s.face = o.face;
  if (typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)) s.color = o.color;
  s.glow = num(o.glow, 0, 2, DEFAULTS.glow);
  s.sens = num(o.sens, -20, 20, DEFAULTS.sens);
  s.gate = num(o.gate, 0, 0.9, DEFAULTS.gate);
  s.x = num(o.x, -1, 1, DEFAULTS.x);
  s.y = num(o.y, -1, 1, DEFAULTS.y);
  s.size = num(o.size, 0.1, 3, DEFAULTS.size);
  return s;
}

export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch { return { ...DEFAULTS }; }
}

export function save(s, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(sanitize(s))); } catch { /* private mode: just forget */ }
}
