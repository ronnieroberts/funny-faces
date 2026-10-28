// Generates examples/christmas.json. Faces are drawn on a 100 x 100 grid in one colour, so outlines are thin
// shapes and rings are a single polygon whose inner loop runs the other way (that makes the hole).
import { writeFileSync } from 'node:fs';
import { validatePack } from '../src/facepack.js';

const r2 = (v) => +v.toFixed(2);
const ell = (cx, cy, rx, ry, n = 16) => Array.from({ length: n }, (_, i) => {
  const t = (i / n) * Math.PI * 2;
  return [r2(cx + rx * Math.cos(t)), r2(cy + ry * Math.sin(t))];
});
const ring = (cx, cy, r, w, n = 40) => {
  const out = ell(cx, cy, r, r, n), inn = ell(cx, cy, r - w, r - w, n);
  return [...out, out[0], inn[0], ...inn.slice(1).reverse(), inn[0]];
};
const line = ([x1, y1], [x2, y2], w) => {                  // a thin quad along a segment
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = (-dy / L) * (w / 2), ny = (dx / L) * (w / 2);
  return [[r2(x1 + nx), r2(y1 + ny)], [r2(x2 + nx), r2(y2 + ny)], [r2(x2 - nx), r2(y2 - ny)], [r2(x1 - nx), r2(y1 - ny)]];
};
const star = (cx, cy, R, r) => Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r : R;
  return [r2(cx + d * Math.cos(a)), r2(cy + d * Math.sin(a))];
});
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const zigzagBand = (x0, x1, y, h, teeth) => {              // flat top, zigzag bottom
  const pts = [[x0, y], [x1, y]];
  for (let i = 0; i <= teeth; i++) pts.push([r2(x1 - ((x1 - x0) * i) / teeth), r2(y + h + (i % 2 ? 0 : 3))]);
  return pts;
};

const shape = (points, o = {}) => ({ kind: 'shape', points, ...o });
const eyes = (cx, cy, rx, ry, extra = {}) => shape(ell(cx, cy, rx, ry, 14), { mirror: true, blink: true, ...extra });
const brows = (x0, y0, x1, y1, dy = -3) => shape(line([x0, y0], [x1, y1], 2.6), { mirror: true, react: { dy } });
const carrot = (y = 47, h = 14, w = 4) => shape([[50 - w, y], [50 + w, y], [50, y + h]]);
const dot = (cx, cy, r) => shape(ell(cx, cy, r, r, 10));

// Curved smile mouth: corners up, centre low. `depth` is how far the middle drops when fully open.
function smile({ x0 = 30, x1 = 70, y = 66, curve = 5, depth = 16, n = 12, thick = 2, flat = false } = {}) {
  const top = [], open = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, bow = flat ? 0 : 1 - (2 * t - 1) ** 2, x = r2(x0 + (x1 - x0) * t), ty = r2(y + curve * bow);
    top.push([x, ty]);
    open.push([x, r2(ty + depth * (0.12 + 0.88 * (flat ? 1 : bow)))]);
  }
  return { kind: 'mouth', top, open, thick, widthRange: [0.9, 1.08] };
}

const faces = [];

// ---------------------------------------------------------------- snowmen
faces.push({ id: 'snowman', name: 'Snowman', layers: [
  shape(ring(50, 50, 44, 2.6)), eyes(38, 40, 3.6, 3.6), carrot(46, 15, 4.2), dot(24, 60, 2.2), dot(76, 60, 2.2),
  smile({ x0: 30, x1: 70, y: 70, curve: 5, depth: 14 })] });

faces.push({ id: 'snowman-top-hat', name: 'Snowman in a Top Hat', layers: [
  shape(rect(33, 6, 67, 28)), shape(rect(22, 28, 78, 33)),
  shape(ring(50, 64, 33, 2.4)), eyes(40, 58, 3.2, 3.2), carrot(63, 11, 3.6),
  smile({ x0: 34, x1: 66, y: 77, curve: 4, depth: 12 })] });

faces.push({ id: 'snowman-scarf', name: 'Snowman with a Scarf', layers: [
  shape(ring(50, 42, 38, 2.4)), eyes(39, 34, 3.4, 3.4), carrot(40, 14, 4),
  smile({ x0: 33, x1: 67, y: 56, curve: 4, depth: 12 }),
  shape([[14, 79], [86, 79], [86, 89], [76, 89], [76, 98], [68, 98], [68, 89], [14, 89]]), shape(rect(78, 89, 85, 94))] });

faces.push({ id: 'snowman-grumpy', name: 'Grumpy Snowman', layers: [
  shape(ring(50, 50, 44, 2.6)), brows(26, 31, 44, 38, -4), eyes(37, 45, 3, 3), carrot(51, 13, 3.6),
  smile({ x0: 32, x1: 68, y: 72, curve: 0, depth: 14, flat: true })] });

// ---------------------------------------------------------------- trees
const treeOutline = [
  shape(line([50, 15], [33, 38], 2.4), { mirror: true }), shape(line([33, 38], [42, 38], 2.4), { mirror: true }),
  shape(line([42, 38], [21, 61], 2.4), { mirror: true }), shape(line([21, 61], [31, 61], 2.4), { mirror: true }),
  shape(line([31, 61], [9, 87], 2.4), { mirror: true }), shape(line([9, 87], [91, 87], 2.4)),
  shape(rect(43, 87, 57, 96)),
];
faces.push({ id: 'christmas-tree', name: 'Christmas Tree', layers: [
  shape(star(50, 8, 8, 3.4)), ...treeOutline, eyes(40, 50, 3.6, 4.2, { react: { dy: -1 } }), dot(50, 57, 1.8),
  smile({ x0: 33, x1: 67, y: 69, curve: 4, depth: 11 })] });

faces.push({ id: 'christmas-tree-lights', name: 'Tree with Lights', layers: [
  shape(star(50, 8, 8, 3.4)), ...treeOutline, eyes(40, 50, 3.6, 4.2),
  dot(40, 27, 2), dot(60, 27, 2), dot(22, 50, 2), dot(78, 50, 2), dot(17, 73, 2), dot(83, 73, 2), dot(30, 83, 2), dot(70, 83, 2),
  smile({ x0: 33, x1: 67, y: 69, curve: 4, depth: 11 })] });

// ---------------------------------------------------------------- elves
const elfHat = (tip = 1) => {
  const fx = (x) => (tip < 0 ? 100 - x : x);
  return [
    shape([[27, 31], [73, 31], [62, 14], [72, 6], [46, 12], [40, 20]].map(([x, y]) => [fx(x), y])),
    shape(ell(fx(74), 6, 4.2, 4.2, 10)),
    shape(zigzagBand(23, 77, 31, 3, 9)),
  ];
};
const ears = (tall = 1) => shape([[21, 48], [3, 48 - 15 * tall], [15, 62]], { mirror: true });

faces.push({ id: 'elf', name: 'Elf', layers: [
  ...elfHat(), ears(), eyes(37, 48, 4.6, 5.4), dot(50, 58, 2.6),
  smile({ x0: 30, x1: 70, y: 70, curve: 5, depth: 17 })] });

faces.push({ id: 'elf-cheeky', name: 'Cheeky Elf', layers: [
  ...elfHat(-1), ears(1.2), brows(26, 38, 44, 34, -4), eyes(37, 48, 3.6, 4.4), dot(50, 58, 2.4),
  smile({ x0: 26, x1: 74, y: 68, curve: 7, depth: 20, n: 14 })] });

faces.push({ id: 'elf-jolly', name: 'Jolly Elf', layers: [
  ...elfHat(), ears(0.9), eyes(36, 48, 5.2, 5.8), shape(ell(25, 62, 6, 4.6, 12), { mirror: true }), dot(50, 58, 3),
  smile({ x0: 34, x1: 66, y: 72, curve: 6, depth: 18 })] });

const pack = validatePack({ format: 'pumpkin-face-pack', version: 1, id: 'christmas', name: 'Christmas',
  author: 'Funny Faces', license: 'Free to use', faces });
writeFileSync('examples/christmas.json', JSON.stringify(pack, null, 1) + '\n');
console.log(`examples/christmas.json: ${pack.faces.length} faces`);
