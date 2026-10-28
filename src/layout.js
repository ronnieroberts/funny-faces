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

/** Several pumpkins: up to 4 in a row, more in two rows. Cells are square and touch.
 *  Returns one {left, top, s} per pumpkin. x, y and size place the whole group; each pumpkin adds its own dx, dy (in
 *  cell widths) and scale. For one pumpkin this is the same as placement(). */
export function placeAll(w, h, { x, y, size }, pumpkins) {
  const n = pumpkins.length, rows = n > 4 ? 2 : 1, cols = Math.ceil(n / rows);
  const cell = Math.min(w / cols, h / rows) * size;
  const cx = w / 2 + (x * w) / 2, cy = h / 2 + (y * h) / 2;
  return pumpkins.map((p, i) => {
    const row = rows === 2 ? (i < cols ? 0 : 1) : 0;
    const inRow = rows === 2 ? (row === 0 ? cols : n - cols) : n, col = rows === 2 ? (row === 0 ? i : i - cols) : i;
    const s = cell * p.scale;
    const mx = cx + (col - (inRow - 1) / 2) * cell + p.dx * cell, my = cy + (row - (rows - 1) / 2) * cell + p.dy * cell;
    return { s, left: mx - s / 2, top: my - s / 2 };
  });
}
