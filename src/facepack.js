// Face packs: plain JSON data, no code. See FACEPACK.md for the format.
// A pack is safe to import from anywhere because validatePack() only keeps
// known fields, clamps numbers and caps sizes.

export const FORMAT = 'pumpkin-face-pack';
export const LIMITS = { faces: 50, layers: 40, points: 200 };

const ell = (cx, cy, rx, ry, n = 14) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [+(cx + rx * Math.cos(t)).toFixed(2), +(cy + ry * Math.sin(t)).toFixed(2)];
  });

// A mouth is a top edge (closed shape, e.g. teeth) and the same number of
// bottom points describing how it looks fully open. The app interpolates.
function zigMouth({ x0 = 22, x1 = 78, y = 68, n = 14, tooth = 2.5, depth = 22, flat = false, thick = 1.6 } = {}) {
  const top = [], open = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = +(x0 + (x1 - x0) * t).toFixed(2);
    top.push([x, +(y + (k % 2 ? -1 : 1) * tooth).toFixed(2)]);
    const curve = flat ? 1 : 1 - (2 * t - 1) ** 2;
    open.push([x, +(y + depth * (flat ? 1 : 0.15 + 0.85 * curve)).toFixed(2)]);
  }
  return { kind: 'mouth', top, open, thick, widthRange: [0.62, 1.12] };
}

const nose = (y = 46, w = 4.5, h = 8) => ({
  kind: 'shape', points: [[50, y - h * 0.6], [50 - w, y + h * 0.4], [50 + w, y + h * 0.4]],
});

export const STARTER_PACK = {
  format: FORMAT, version: 1, id: 'starter', name: 'Starter Pack', author: 'Funny Faces', license: 'Free',
  faces: [
    { id: 'classic', name: 'Classic Triangle', layers: [
      { kind: 'shape', points: [[22, 36], [40, 36], [31, 14]], mirror: true, blink: true, react: { dy: -3 } },
      nose(), zigMouth({}),
    ] },
    { id: 'round', name: 'Round Eyes', layers: [
      { kind: 'shape', points: ell(30, 32, 8, 9), mirror: true, blink: true },
      nose(48), zigMouth({ x0: 24, x1: 76, y: 66, n: 12, tooth: 1.2, depth: 24 }),
    ] },
    { id: 'cat', name: 'Cat', layers: [
      { kind: 'shape', points: [[16, 36], [32, 24], [44, 34], [30, 42]], mirror: true, blink: true, smooth: true },
      nose(50, 4, 6), zigMouth({ x0: 28, x1: 72, y: 66, n: 10, tooth: 1.2, depth: 14 }),
    ] },
    { id: 'angry', name: 'Angry', layers: [
      { kind: 'shape', points: [[16, 22], [44, 36], [40, 44], [16, 38]], mirror: true, blink: true, react: { dy: -3 } },
      nose(), zigMouth({ x0: 18, x1: 82, y: 66, n: 16, tooth: 3.5, depth: 26 }),
    ] },
    { id: 'skull', name: 'Skull', layers: [
      { kind: 'shape', points: ell(31, 34, 10, 11), mirror: true, blink: true },
      { kind: 'shape', points: [[50, 44], [44, 56], [56, 56]] },
      zigMouth({ x0: 24, x1: 76, y: 68, n: 12, tooth: 0.3, depth: 20, flat: true }),
    ] },
    { id: 'flames', name: 'Flames', layers: [
      // Eyes, nose and mouth are made of fire: flames flicker above them and the mouth burns.
      { kind: 'shape', points: ell(30, 40, 8.5, 7, 12), mirror: true, blink: true, flame: { height: 17, intensity: 1.1 } },
      { kind: 'shape', points: [[50, 46], [46, 54], [54, 54]], flame: { height: 8, intensity: 0.6 } },
      { ...zigMouth({ x0: 22, x1: 78, y: 68, n: 12, tooth: 0.4, depth: 22 }), fire: true },
    ] },
    { id: 'grin', name: 'Big Grin', layers: [
      { kind: 'shape', points: ell(32, 34, 5, 6), mirror: true, blink: true },
      nose(46, 3.5, 6), zigMouth({ x0: 14, x1: 86, y: 58, n: 18, tooth: 3, depth: 32 }),
    ] },
  ],
};

// ---------------------------------------------------------------- validation

const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const slug = (v) => str(v, 64).replace(/[^\w-]/g, '-') || 'x';

function points(arr, min = 2) {
  if (!Array.isArray(arr) || arr.length < min || arr.length > LIMITS.points) throw new Error('bad point list');
  return arr.map((p) => {
    if (!Array.isArray(p) || p.length < 2) throw new Error('bad point');
    return [num(p[0], -20, 120), num(p[1], -20, 120)];
  });
}

// A shape can burn: `flame: true` or `flame: {height, intensity}` draws flickering flames above it.
function flameSpec(v) {
  if (v === true) return { height: 12, intensity: 1 };
  if (v && typeof v === 'object' && !Array.isArray(v)) return { height: num(v.height, 0, 40, 12), intensity: num(v.intensity, 0, 3, 1) };
  return null;
}

export function validatePack(obj) {
  if (!obj || obj.format !== FORMAT || obj.version !== 1) throw new Error('Not a Funny Faces face pack (version 1)');
  if (!Array.isArray(obj.faces) || !obj.faces.length || obj.faces.length > LIMITS.faces) throw new Error('Pack has no faces or too many');
  const faces = obj.faces.map((f) => {
    if (!Array.isArray(f.layers) || !f.layers.length || f.layers.length > LIMITS.layers) throw new Error('Bad layer list');
    const layers = f.layers.map((l) => {
      if (l.kind === 'mouth') {
        const top = points(l.top), open = points(l.open);
        if (top.length !== open.length) throw new Error('Mouth top/open must have equal point counts');
        const wr = Array.isArray(l.widthRange) ? l.widthRange : [1, 1];
        return { kind: 'mouth', top, open, thick: num(l.thick, 0, 10, 1.5),
                 widthRange: [num(wr[0], 0.3, 2, 1), num(wr[1], 0.3, 2, 1)],
                 ...(l.fire ? { fire: true } : {}) };
      }
      if (l.kind === 'shape') {
        const out = { kind: 'shape', points: points(l.points, 3), mirror: !!l.mirror, blink: !!l.blink, smooth: !!l.smooth,
                      react: { dy: num(l.react && l.react.dy, -20, 20, 0) } };
        const fl = flameSpec(l.flame);
        if (fl) out.flame = fl;
        return out;
      }
      throw new Error('Unknown layer kind');
    });
    return { id: slug(f.id), name: str(f.name, 80, 'Face'), layers };
  });
  return { format: FORMAT, version: 1, id: slug(obj.id), name: str(obj.name, 80, 'Pack'),
           author: str(obj.author, 80), license: str(obj.license, 200), faces };
}

// ---------------------------------------------------------------- drawing

function tracePath(ctx, pts, smooth) {
  ctx.beginPath();
  if (smooth) {
    const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m0 = mid(pts[n - 1], pts[0]);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid(pts[i], pts[(i + 1) % n]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
  } else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.closePath();
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------- fire

let FIRE = { core: '255,246,200', mid: '255,196,90', edge: '255,120,40' };

/** Parse #rgb, #rrggbb or rgb(r,g,b) into [r,g,b], or null. */
function parseColor(c) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/** Fire colours from the face colour: the colour itself in the body, near white at the hot core, deeper at the edge. */
export function firePalette(color) {
  const c = parseColor(color);
  if (!c) return { core: '255,246,200', mid: '255,196,90', edge: '255,120,40' };
  const mix = (a, b, f) => c.map((v, i) => Math.round(v + ((a ? 255 : b) - v) * f)).join(',');
  return { core: mix(true, 0, 0.8), mid: c.join(','), edge: mix(false, 0, 0.35) };
}

/** Gradient for flame tongues: soft at the base, light and translucent, fading out at the tip. */
function fireGradient(ctx, yBase, yTip) {
  const g = ctx.createLinearGradient(0, yBase, 0, yTip);
  g.addColorStop(0, `rgba(${FIRE.core},0)`);
  g.addColorStop(0.14, `rgba(${FIRE.core},0.62)`);
  g.addColorStop(0.5, `rgba(${FIRE.mid},0.48)`);
  g.addColorStop(1, `rgba(${FIRE.edge},0)`);
  return g;
}

/** Round glow for a burning eye or nose: bright in the middle, no edge at all. */
function glowGradient(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${FIRE.core},0.9)`);
  g.addColorStop(0.55, `rgba(${FIRE.mid},0.55)`);
  g.addColorStop(1, `rgba(${FIRE.edge},0)`);
  return g;
}

/** Gradient for the inside of a burning mouth: soft at the bottom, still glowing at the top so it joins the lip. */
function mouthGradient(ctx, yBottom, yTop) {
  const g = ctx.createLinearGradient(0, yBottom, 0, yTop);
  g.addColorStop(0, `rgba(${FIRE.core},0)`);
  g.addColorStop(0.2, `rgba(${FIRE.core},0.7)`);
  g.addColorStop(0.7, `rgba(${FIRE.mid},0.58)`);
  g.addColorStop(1, `rgba(${FIRE.mid},0.4)`);
  return g;
}

/** Outline height of a polygon at n evenly spaced x positions: top (min y) or bottom (max y). */
function contour(pts, n, bottom = false) {
  let x0 = Infinity, x1 = -Infinity;
  for (const [x] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0);
    let best = null;
    for (let j = 0; j < pts.length; j++) {
      const [ax, ay] = pts[j], [bx, by] = pts[(j + 1) % pts.length];
      if (ax === bx || x < Math.min(ax, bx) || x > Math.max(ax, bx)) continue;
      const y = ay + ((x - ax) / (bx - ax)) * (by - ay);
      if (best === null || (bottom ? y > best : y < best)) best = y;
    }
    if (best !== null) out.push([x, best]);
  }
  return { cols: out, width: (x1 - x0) / Math.max(1, n) };
}

/** Flame tongues standing on a list of [x, baseY] points, drawn upward (negative y). */
function tongues(ctx, cols, colWidth, height, t, seed, rise = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  cols.forEach(([x, y], i) => {
    const f = Math.abs(Math.sin(t * 6.1 + i * 1.9 + seed) * Math.sin(t * 2.7 + i * 0.8 + seed * 1.7));
    const h = height * (0.3 + 0.7 * f) * rise;
    const w = colWidth * 1.3;
    const sway = Math.sin(t * 4.3 + i * 2.1 + seed) * w * 0.35;
    ctx.fillStyle = fireGradient(ctx, y, y - h);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + 1.2);
    ctx.quadraticCurveTo(x - w * 0.25 + sway * 0.5, y - h * 0.55, x + sway, y - h);
    ctx.quadraticCurveTo(x + w * 0.25 + sway * 0.5, y - h * 0.55, x + w / 2, y + 1.2);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

/**
 * One continuous flame crown whose bottom follows a contour (for example the top of an eye).
 * Draw it BEFORE the shape so the shape covers the base; pts are [x, baseY] left to right.
 */
function crown(ctx, pts, colWidth, height, t, seed, dip = 2.5) {
  const n = pts.length;
  if (n < 2 || height <= 0) return;
  const tips = pts.map(([x, y], i) => {
    const f = Math.abs(Math.sin(t * 6.1 + i * 1.9 + seed) * Math.sin(t * 2.7 + i * 0.8 + seed * 1.7));
    const h = height * (0.3 + 0.7 * f);
    return { x, y, h, sway: Math.sin(t * 4.3 + i * 2.1 + seed) * colWidth * 0.35 };
  });
  const half = colWidth * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = fireGradient(ctx, Math.max(...tips.map((p) => p.y)) + dip, Math.min(...tips.map((p) => p.y - p.h)));
  ctx.beginPath();
  ctx.moveTo(tips[0].x - half, tips[0].y);
  tips.forEach((p, i) => {
    ctx.quadraticCurveTo(p.x - half * 0.5 + p.sway * 0.5, p.y - p.h * 0.55, p.x + p.sway, p.y - p.h);
    const next = tips[i + 1];
    const vx = next ? (p.x + next.x) / 2 : p.x + half;
    const vy = next ? (p.y + next.y) / 2 - 0.25 * Math.min(p.h, next.h) : p.y;
    ctx.quadraticCurveTo(p.x + half * 0.5 + p.sway * 0.5, p.y - p.h * 0.55, vx, vy);
  });
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(tips[i].x, tips[i].y + dip);   // bottom follows the contour
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draw one face on an S x S canvas context.
 *  st = {open, bright, blink, energy, color, glow, alpha, time?}  (time in seconds animates flames) */
export function drawFace(ctx, face, S, st) {
  const k = S / 100, t = st.time || 0, lift = 1 + 0.6 * st.energy;
  FIRE = firePalette(st.color);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = clamp01(st.alpha);
  ctx.fillStyle = ctx.shadowColor = st.color;
  const blur = st.shadow === false ? 0 : st.glow * S * 0.035;         // soft halo round plain shapes; flames carry their own glow
  const detail = st.detail || 1;                                      // 1 = every flame tongue, less = fewer (faster)
  ctx.shadowBlur = blur;
  ctx.setTransform(k, 0, 0, k, 0, 0);

  const mirrorPts = (pts) => pts.map(([x, y]) => [100 - x, y]).reverse();
  face.layers.forEach((l, li) => {
    ctx.shadowBlur = st.cheapGlow && (l.flame || l.fire) ? 0 : blur;   // a blurred shadow under translucent flames costs most of the drawing time
    if (l.kind === 'shape') {
      const variants = l.mirror ? [l.points, mirrorPts(l.points)] : [l.points];
      variants.forEach((pts, vi) => {
        let cy = 0;
        for (const p of pts) cy += p[1];
        cy /= pts.length;
        const sy = l.blink ? 1 - 0.9 * st.blink : 1, dy = l.react.dy * st.energy;
        const moved = pts.map(([x, y]) => [x, cy + (y - cy) * sy + dy]);
        if (l.flame) {
          const ys = moved.map((p) => p[1]), xs = moved.map((p) => p[0]);
          const top = Math.min(...ys), bottom = Math.max(...ys), left = Math.min(...xs), right = Math.max(...xs);
          const { cols, width } = contour(moved, Math.max(3, Math.min(12, Math.round(((right - left) / 3) * detail))));
          // flames first, so they sit behind the shape and rise from its top edge
          crown(ctx, cols, width, l.flame.height * l.flame.intensity * lift * (1 - 0.8 * st.blink), t, li * 3.1 + vi * 5.3);
          ctx.save();
          ctx.fillStyle = glowGradient(ctx, (left + right) / 2, (top + bottom) / 2, Math.max(right - left, bottom - top) * 0.62);
          tracePath(ctx, moved, l.smooth);
          ctx.fill();
          ctx.restore();
        } else {
          tracePath(ctx, moved, l.smooth);
          ctx.fill();
        }
      });
    } else {
      const o = clamp01(st.open * (1 - 0.45 * st.bright));
      const wf = l.widthRange[0] + (l.widthRange[1] - l.widthRange[0]) * (1 - st.bright);
      const wx = (x) => 50 + (x - 50) * wf;
      const n = l.top.length, poly = [];
      for (let i = 0; i < n; i++) poly.push([wx(l.top[i][0]), l.top[i][1]]);
      for (let i = n - 1; i >= 0; i--) {
        const closed = l.top[i][1] + l.thick;
        poly.push([wx(l.open[i][0]), Math.max(closed, closed + (l.open[i][1] - closed) * o)]);
      }
      if (l.fire) {
        const ys = poly.map((p) => p[1]);
        const top = Math.min(...ys), bottom = Math.max(...ys);
        const span = Math.max(4, bottom - top);
        ctx.save();
        ctx.fillStyle = mouthGradient(ctx, bottom, top);
        tracePath(ctx, poly, false);
        ctx.fill();
        ctx.restore();
        const { cols, width } = contour(poly, Math.max(4, Math.round(12 * detail)), true);
        tongues(ctx, cols, width, span * 1.2 + 4 + 5 * st.energy, t, li * 3.1 + 11.7);
        // the lip itself flickers too, so even a closed mouth is a line of fire
        const lip = contour(poly.slice(0, n), Math.max(4, Math.round(12 * detail)));
        tongues(ctx, lip.cols, lip.width, 5 * lift, t, li * 3.1 + 17.3);
      } else {
        tracePath(ctx, poly, false);
        ctx.fill();
      }
    }
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}
