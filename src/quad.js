// Pure geometry for a pumpkin's quad: 4 corners (TL, TR, BR, BL) as fractions of the stage. No DOM in here.
// Maths runs in "height units" (x times the aspect A = width / height) so scaling and rotating stay square.
// Edge e runs from corner e to corner e+1: 0 top, 1 right, 2 bottom, 3 left.
import { placeAll } from './layout.js';

export const RANGE = [-0.5, 1.5];        // corners may leave the stage a little, never fly off
export const MIN_SIZE = 0.04;            // shortest edge, in stage heights
export const MIN_FACTOR = 0.05;          // one scale step never shrinks below this fraction
const MIN_SIN = 0.05;                    // corners sharper than about 3 degrees count as degenerate
const DEFAULT_A = 16 / 9;

const toPx = (q, A) => q.map(([x, y]) => [x * A, y]);
const fromPx = (p, A) => p.map(([x, y]) => [x / A, y]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a, fallback = [1, 0]) => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l] : fallback; };
const finite = (n, d) => (Number.isFinite(n) ? n : d);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const copy = (q) => q.map((c) => [...c]);

/** Centre of the four corners, in height units. */
export function centroidPx(pq) {
  return [pq.reduce((a, p) => a + p[0], 0) / 4, pq.reduce((a, p) => a + p[1], 0) / 4];
}
export const centroid = (q, A) => centroidPx(toPx(q, A));

/** Mid point of edge e. */
export function edgeMid(pq, e) {
  const a = pq[e], b = pq[(e + 1) % 4];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Average edge length in stage heights. */
export function sizeOf(q, A) {
  const pq = toPx(q, A);
  return pq.reduce((a, p, i) => a + len(sub(pq[(i + 1) % 4], p)), 0) / 4;
}

/** A square of the given size (stage heights) centred on (cx, cy). */
export function squareQuad(cx, cy, size, A) {
  const hw = size / 2 / A, hh = size / 2;
  return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
}

/** Four finite points, inside RANGE, clockwise, convex, no edge too short, no corner nearly flat. */
export function isValid(q, A = DEFAULT_A) {
  if (!Array.isArray(q) || q.length !== 4) return false;
  for (const c of q) {
    if (!Array.isArray(c) || c.length !== 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return false;
    if (c[0] < RANGE[0] || c[0] > RANGE[1] || c[1] < RANGE[0] || c[1] > RANGE[1]) return false;
  }
  const pq = toPx(q, A);
  for (let i = 0; i < 4; i++) {
    const a = sub(pq[(i + 1) % 4], pq[i]), b = sub(pq[(i + 2) % 4], pq[(i + 1) % 4]);
    const la = len(a), lb = len(b);
    if (la < MIN_SIZE || lb < MIN_SIZE) return false;
    if ((a[0] * b[1] - a[1] * b[0]) / (la * lb) < MIN_SIN) return false;
  }
  return true;
}

/** A clean copy of q (coordinates rounded), or null if it is not a usable quad. Out-of-range numbers are clamped first. */
export function sanitizeQuad(q, A = DEFAULT_A) {
  if (!Array.isArray(q) || q.length !== 4) return null;
  const out = [];
  for (const c of q) {
    if (!Array.isArray(c) || c.length !== 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    out.push([Math.round(clamp(c[0], RANGE) * 1e4) / 1e4, Math.round(clamp(c[1], RANGE) * 1e4) / 1e4]);
  }
  return isValid(out, A) ? out : null;
}

/** Keep an edit only if it leaves a usable quad; otherwise stay where we were. */
const accept = (next, prev, A) => (isValid(next, A) ? next : prev);

export function moveQuad(q, dx, dy, A = DEFAULT_A) {
  const xs = q.map((c) => c[0]), ys = q.map((c) => c[1]);
  const mx = clamp(finite(dx, 0), [RANGE[0] - Math.min(...xs), RANGE[1] - Math.max(...xs)]);   // slide to the edge of the range, no further
  const my = clamp(finite(dy, 0), [RANGE[0] - Math.min(...ys), RANGE[1] - Math.max(...ys)]);
  return accept(q.map(([x, y]) => [x + mx, y + my]), q, A);
}

/** Scale about a pivot given in height units. Never smaller than MIN_SIZE; refused if it would leave the range. */
export function scaleAbout(q, f, pivot, A) {
  f = Math.max(finite(f, 1), MIN_FACTOR);
  const s = sizeOf(q, A);
  if (s > 0) f = Math.max(f, (MIN_SIZE * 1.01) / s);
  return accept(fromPx(toPx(q, A).map((p) => [pivot[0] + (p[0] - pivot[0]) * f, pivot[1] + (p[1] - pivot[1]) * f]), A), q, A);
}
/** Scale about the quad's own centre (the zoom handle and the wheel). */
export const scaleQuad = (q, f, A) => scaleAbout(q, f, centroid(q, A), A);

/** Rotate about the quad's centre by ang radians. */
export function rotateQuad(q, ang, A) {
  const [cx, cy] = centroid(q, A), c = Math.cos(finite(ang, 0)), s = Math.sin(finite(ang, 0));
  return accept(fromPx(toPx(q, A).map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]), A), q, A);
}

/** Make the quad a square again: the average side, turned like the top edge, about the same centre. */
export function resetSkew(q, A) {
  const pq = toPx(q, A), size = sizeOf(q, A), ang = Math.atan2(pq[1][1] - pq[0][1], pq[1][0] - pq[0][0]);
  const [cx, cy] = centroidPx(pq), c = Math.cos(ang), s = Math.sin(ang);
  const sq = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + (u * size * c - v * size * s) / 2, cy + (u * size * s + v * size * c) / 2]);
  return accept(fromPx(sq, A), q, A);
}

/** Skew: one corner follows the pointer (fractions); the other three stay put. */
export function dragCorner(q, i, ptr, A) {
  const next = copy(q);
  next[i] = [clamp(finite(ptr[0], q[i][0]), RANGE), clamp(finite(ptr[1], q[i][1]), RANGE)];
  return accept(next, q, A);
}

/** Scale along an axis (unit vector eu, perpendicular ev) by su and sv about an anchor. */
function scaleAxes(pq, anchor, eu, su, sv) {
  const ev = [-eu[1], eu[0]];
  return pq.map((p) => {
    const d = sub(p, anchor), a = dot(d, eu) * su, b = dot(d, ev) * sv;
    return [anchor[0] + eu[0] * a + ev[0] * b, anchor[1] + eu[1] * a + ev[1] * b];
  });
}
const uniformFactor = (d0, d1) => {
  const l2 = dot(d0, d0);
  return l2 < 1e-12 ? 1 : Math.max(MIN_FACTOR, finite(dot(d1, d0) / l2, 1));
};

/** Corner drag that scales instead of skewing (Shift): about the opposite corner, or the centre with opts.centre. */
export function scaleCorner(q, i, ptr, A, opts = {}) {
  const pq = toPx(q, A), p = [ptr[0] * A, ptr[1]];
  const anchor = opts.centre ? centroidPx(pq) : pq[(i + 2) % 4];
  const f = uniformFactor(sub(pq[i], anchor), sub(p, anchor));
  return accept(fromPx(scaleAxes(pq, anchor, [1, 0], f, f), A), q, A);
}

/** Edge midpoint drag: stretch along that edge's normal, keeping the opposite edge in place (or the centre with opts.centre). */
export function stretchAlongEdge(q, e, ptr, A, opts = {}) {
  const pq = toPx(q, A), p = [ptr[0] * A, ptr[1]];
  const m = edgeMid(pq, e), anchor = opts.centre ? centroidPx(pq) : edgeMid(pq, (e + 2) % 4);
  const d0 = sub(m, anchor), d1 = sub(p, anchor);
  if (dot(d0, d0) < 1e-12) return copy(q);
  const n = norm(d0), f = Math.max(MIN_FACTOR, finite(dot(d1, n) / dot(d0, n), 1));
  return accept(fromPx(scaleAxes(pq, anchor, n, f, 1), A), q, A);
}

export function pointInQuad(q, x, y) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- handles and hit testing (stage pixels)

/** Where the handles of q sit on a stage of w x h pixels. k = stage pixels per CSS pixel, so handles keep their size on screen. */
export function handlesOf(q, w, h, k = 1) {
  const c = q.map(([x, y]) => [x * w, y * h]);
  const mid = [c.reduce((a, p) => a + p[0], 0) / 4, c.reduce((a, p) => a + p[1], 0) / 4];
  const edges = [0, 1, 2, 3].map((e) => edgeMid(c, e));
  const away = (m) => { const d = norm(sub(m, mid), [0, -1]); return [m[0] + d[0] * 34 * k, m[1] + d[1] * 34 * k]; };
  return { corners: c, edges, mid, rot: away(edges[0]), zoom: away(edges[2]) };
}

/** What is under (x, y) in stage pixels? quads[i] is null for a pumpkin that is not shown. The selected pumpkin's
 *  handles win over bodies. Bodies are tested front (last) to back. Returns {kind, index, i} or null.
 *  kind: corner and edge (i says which), rotate, zoom, move. */
export function hitTest(quads, selected, x, y, w, h, k = 1) {
  const q = quads[selected];
  if (q) {
    const H = handlesOf(q, w, h, k), near = (p, r) => Math.hypot(p[0] - x, p[1] - y) < r * k;
    for (let i = 0; i < 4; i++) if (near(H.corners[i], 13)) return { kind: 'corner', index: selected, i };
    for (let i = 0; i < 4; i++) if (near(H.edges[i], 11)) return { kind: 'edge', index: selected, i };
    if (near(H.rot, 13)) return { kind: 'rotate', index: selected, i: 0 };
    if (near(H.zoom, 13)) return { kind: 'zoom', index: selected, i: 0 };
  }
  for (let n = quads.length - 1; n >= 0; n--) {
    if (quads[n] && pointInQuad(quads[n], x / w, y / h)) return { kind: 'move', index: n, i: 0 };
  }
  return null;
}

/** Apply a drag to the quad the drag started on. start = the quad when the drag began; ptr and from are
 *  fractions of the stage (where the pointer is now and where it was at the start). */
export function applyDrag(kind, i, start, ptr, from, A, opts = {}) {
  if (kind === 'move') return moveQuad(start, ptr[0] - from[0], ptr[1] - from[1], A);
  if (kind === 'corner') return opts.shift ? scaleCorner(start, i, ptr, A, opts) : dragCorner(start, i, ptr, A);
  if (kind === 'edge') return stretchAlongEdge(start, i, ptr, A, opts);
  const [cx, cy] = centroid(start, A), a = [from[0] * A - cx, from[1] - cy], b = [ptr[0] * A - cx, ptr[1] - cy];
  if (kind === 'rotate') return rotateQuad(start, Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]), A);
  if (kind === 'zoom') return len(a) < 1e-6 ? start : scaleQuad(start, len(b) / len(a), A);
  return start;
}

// ---------------------------------------------------------------- pointer mapping

/** Which way the page shows the canvas: mirror flips it left to right; flip turns it half way round (a ceiling-mounted
 *  projector). Both together is a top-to-bottom flip. Returns whether x and y run backwards for the viewer. */
export function viewSigns({ mirror = false, flip = false } = {}) {
  return { invertX: !!mirror !== !!flip, invertY: !!flip };
}

/** A pointer movement or key step as the viewer sees it, turned into stage direction. */
export function viewDelta(dx, dy, flags) {
  const { invertX, invertY } = viewSigns(flags);
  return [invertX ? -dx : dx, invertY ? -dy : dy];
}

/** Pointer position as fractions (u, v) of the stage, from the canvas's on-screen rectangle, undoing the mirror and flip. */
export function pointerToStage(clientX, clientY, rect, flags = {}) {
  const { invertX, invertY } = viewSigns(flags);
  let u = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  let v = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  if (invertX) u = 1 - u;
  if (invertY) v = 1 - v;
  return { u, v };
}

// ---------------------------------------------------------------- defaults and the whole group

/** The default arrangement: n pumpkins in a row (or two rows) placed by the group's x, y and size (see layout.js).
 *  adj[i] = {dx, dy, scale} are the old per-pumpkin offsets, for settings saved before quads. */
export function gridQuads(n, A, group, adj = []) {
  const H = 1000, W = H * A;
  const spots = placeAll(W, H, group, Array.from({ length: n }, (_, i) => ({ dx: 0, dy: 0, scale: 1, ...(adj[i] || {}) })));
  return spots.map((s) => {
    const q = squareQuad((s.left + s.s / 2) / W, (s.top + s.s / 2) / H, s.s / H, A);
    return sanitizeQuad(q, A) || squareQuad(0.5, 0.5, 0.3, A);
  });
}

/** Move every quad together by a fraction of the stage, stopping when the group reaches the edge of the range. */
export function moveAll(quads, dx, dy) {
  const pts = quads.flat(), xs = pts.map((c) => c[0]), ys = pts.map((c) => c[1]);
  const mx = clamp(finite(dx, 0), [RANGE[0] - Math.min(...xs), RANGE[1] - Math.max(...xs)]);
  const my = clamp(finite(dy, 0), [RANGE[0] - Math.min(...ys), RANGE[1] - Math.max(...ys)]);
  return quads.map((q) => q.map(([x, y]) => [x + mx, y + my]));
}

/** Scale every quad about a point (fractions of the stage). All or nothing. */
export function scaleAll(quads, f, about, A) {
  const next = quads.map((q) => scaleAbout(q, f, [about[0] * A, about[1]], A));
  return next.some((q, i) => q === quads[i]) ? quads : next;
}

// ---------------------------------------------------------------- perspective

/** Perspective-correct weights for the four corners, from where the quad's diagonals cross. A flat 2D quad drawn
 *  as two triangles shears the picture; dividing by these weights in the shader makes it look like a tilted plane. */
export function quadQ(P) {
  const [p0, p1, p2, p3] = P;
  const d1 = sub(p2, p0), d2 = sub(p3, p1);
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return [1, 1, 1, 1];
  const t = ((p1[0] - p0[0]) * d2[1] - (p1[1] - p0[1]) * d2[0]) / den;
  const c = [p0[0] + d1[0] * t, p0[1] + d1[1] * t];
  const d = P.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]));
  if (d.some((x) => x < 1e-9)) return [1, 1, 1, 1];
  return [(d[0] + d[2]) / d[2], (d[1] + d[3]) / d[3], (d[2] + d[0]) / d[0], (d[3] + d[1]) / d[1]];
}

/** Longest edge of the quad in stage pixels: how big the face really is on screen. */
export function screenSize(q, w, h) {
  const c = q.map(([x, y]) => [x * w, y * h]);
  return Math.max(...c.map((p, i) => len(sub(c[(i + 1) % 4], p))));
}

/** The same place with left and right swapped (corners TL, TR, BR, BL become TR, TL, BL, BR): drawing a picture on it flips the picture, not the place. */
export const mirrorQuad = (q) => [q[1], q[0], q[3], q[2]];
