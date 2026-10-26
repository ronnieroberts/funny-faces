// Where the face sits in the window. x and y are the face centre as a fraction of the window
// (0 is the middle, -1 and 1 are the edges); size is the face width as a fraction of the shorter side.
export const LIMITS = { x: [-1, 1], y: [-1, 1], size: [0.1, 3] };
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

export function placement(w, h, { x, y, size }) {
  const s = Math.min(w, h) * size;
  return { s, left: w / 2 + (x * w) / 2 - s / 2, top: h / 2 + (y * h) / 2 - s / 2 };
}

/** Move by a pixel drag. */
export function drag(l, dxPx, dyPx, w, h) {
  return { ...l, x: clamp(l.x + (dxPx * 2) / w, LIMITS.x), y: clamp(l.y + (dyPx * 2) / h, LIMITS.y) };
}

/** Multiply the size (wheel, pinch, keys). */
export function scale(l, factor) {
  return { ...l, size: clamp(l.size * factor, LIMITS.size) };
}

export const nudge = (l, dx, dy) => ({ ...l, x: clamp(l.x + dx, LIMITS.x), y: clamp(l.y + dy, LIMITS.y) });
