import test from 'node:test';
import assert from 'node:assert/strict';
import { moveQuad, scaleQuad, rotateQuad, resetSkew, dragCorner, scaleCorner, stretchAlongEdge, pointInQuad, hitTest, handlesOf,
  applyDrag, isValid, sanitizeQuad, squareQuad, sizeOf, centroid, gridQuads, moveAll, scaleAll, quadQ, screenSize,
  pointerToStage, viewSigns, viewDelta, MIN_SIZE, RANGE } from '../src/quad.js';
import { tileSize } from '../src/stage.js';

const A = 16 / 9;
const sq = () => squareQuad(0.5, 0.5, 0.4, A);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearQ = (p, q) => p.forEach((c, i) => { near(c[0], q[i][0]); near(c[1], q[i][1]); });

test('a square quad is valid and has the size asked for', () => {
  assert.ok(isValid(sq(), A));
  near(sizeOf(sq(), A), 0.4);
  const [cx, cy] = centroid(sq(), A);
  near(cx, 0.5 * A); near(cy, 0.5);
});

test('move shifts every corner and stops at the edge of the range', () => {
  nearQ(moveQuad(sq(), 0.1, -0.1, A), sq().map(([x, y]) => [x + 0.1, y - 0.1]));
  const far = moveQuad(sq(), 50, 50, A);
  assert.ok(isValid(far, A));
  near(Math.max(...far.map((c) => c[0])), RANGE[1]);
  near(Math.max(...far.map((c) => c[1])), RANGE[1]);
  nearQ(moveQuad(sq(), NaN, NaN, A), sq());
});

test('scale keeps the centre and multiplies the size', () => {
  const q = scaleQuad(sq(), 1.5, A);
  near(sizeOf(q, A), 0.6);
  const [cx, cy] = centroid(q, A);
  near(cx, 0.5 * A); near(cy, 0.5);
});

test('minimum size: shrinking stops, nothing collapses', () => {
  let q = sq();
  for (let i = 0; i < 40; i++) q = scaleQuad(q, 0.1, A);
  assert.ok(sizeOf(q, A) >= MIN_SIZE - 1e-9);
  assert.ok(isValid(q, A));
  assert.ok(isValid(scaleQuad(sq(), 0, A), A));
  assert.ok(isValid(scaleQuad(sq(), NaN, A), A));
});

test('scale is refused when it would leave the range', () => {
  assert.deepEqual(scaleQuad(sq(), 50, A), sq());
});

test('rotate keeps the size and centre and turns the top edge', () => {
  const q = rotateQuad(sq(), Math.PI / 2, A);
  near(sizeOf(q, A), 0.4);
  const [cx, cy] = centroid(q, A);
  near(cx, 0.5 * A); near(cy, 0.5);
  const top = [(q[1][0] - q[0][0]) * A, q[1][1] - q[0][1]];
  near(top[0], 0, 1e-9); near(top[1], 0.4, 1e-9);
  nearQ(rotateQuad(rotateQuad(sq(), 0.7, A), -0.7, A), sq());
});

test('corner drag moves one corner only (skew)', () => {
  const q = dragCorner(sq(), 2, [0.8, 0.8], A);
  nearQ([q[0], q[1], q[3]], [sq()[0], sq()[1], sq()[3]]);
  assert.deepEqual(q[2], [0.8, 0.8]);
});

test('corner drag that would fold the quad or leave the range is refused or clamped', () => {
  assert.deepEqual(dragCorner(sq(), 2, [0.2, 0.2], A), sq());             // past the opposite corner: inverted
  assert.deepEqual(dragCorner(sq(), 2, [0.5 - 0.2 / A + 0.001, 0.31], A), sq());   // nearly onto another corner
  const q = dragCorner(sq(), 2, [99, 99], A);
  near(q[2][0], RANGE[1]); near(q[2][1], RANGE[1]);
  assert.deepEqual(dragCorner(sq(), 2, [NaN, NaN], A), sq());
});

test('convex only: a dented quad is not valid', () => {
  const q = sq(); q[2] = [0.5, 0.5];
  assert.equal(isValid(q, A), false);
});

test('Shift corner drag scales about the opposite corner', () => {
  const q = sq(), br = q[2];
  const out = scaleCorner(q, 0, [q[0][0] - 0.1, q[0][1] - 0.1 * A], A);
  nearQ([out[2]], [br]);
  assert.ok(sizeOf(out, A) > 0.4);
});

test('edge drag stretches along its axis only', () => {
  const q = sq(), out = stretchAlongEdge(q, 1, [q[1][0] + 0.1, 0.5], A);     // right edge pulled right
  near(out[0][0], q[0][0]); near(out[3][0], q[3][0]);
  near(out[1][0], q[1][0] + 0.1);
  near(out[1][1], q[1][1]);
  const back = stretchAlongEdge(q, 1, [q[0][0], 0.5], A);                    // dragged onto the opposite edge: not below min
  assert.ok(isValid(back, A));
});

test('rotated quad: edge drag follows its own axis', () => {
  const q = rotateQuad(sq(), Math.PI / 2, A);
  const m = [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2];
  const out = stretchAlongEdge(q, 1, [m[0], m[1] + 0.1], A);
  assert.ok(sizeOf(out, A) > sizeOf(q, A));
  assert.ok(isValid(out, A));
});

test('reset skew gives a square again, same centre', () => {
  const skew = dragCorner(sq(), 2, [0.8, 0.7], A);
  const r = resetSkew(skew, A);
  near(sizeOf(r, A), sizeOf(skew, A));
  const px = r.map(([x, y]) => [x * A, y]);
  near(Math.hypot(px[1][0] - px[0][0], px[1][1] - px[0][1]), Math.hypot(px[2][0] - px[1][0], px[2][1] - px[1][1]));
  near(centroid(r, A)[0], centroid(skew, A)[0]); near(centroid(r, A)[1], centroid(skew, A)[1]);
});

test('hit testing: inside, outside, handles win, front pumpkin wins', () => {
  assert.ok(pointInQuad(sq(), 0.5, 0.5));
  assert.equal(pointInQuad(sq(), 0.05, 0.05), false);
  const w = 1600, h = 900, q = sq();
  const H = handlesOf(q, w, h, 1);
  assert.deepEqual(hitTest([q], 0, 800, 450, w, h), { kind: 'move', index: 0, i: 0 });
  assert.equal(hitTest([q], 0, 5, 5, w, h), null);
  assert.deepEqual(hitTest([q], 0, H.corners[2][0] + 3, H.corners[2][1], w, h), { kind: 'corner', index: 0, i: 2 });
  assert.deepEqual(hitTest([q], 0, H.edges[1][0], H.edges[1][1], w, h), { kind: 'edge', index: 0, i: 1 });
  assert.equal(hitTest([q], 0, H.rot[0], H.rot[1], w, h).kind, 'rotate');
  assert.equal(hitTest([q], 0, H.zoom[0], H.zoom[1], w, h).kind, 'zoom');
  assert.equal(hitTest([q], 1, H.rot[0], H.rot[1], w, h), null);               // only the selected pumpkin has handles
  assert.equal(hitTest([sq(), sq()], 0, 800, 450, w, h).index, 1);              // last drawn is on top
  assert.equal(hitTest([sq(), null], 1, 800, 450, w, h).index, 0);              // a hidden pumpkin is skipped
  assert.equal(hitTest([q], 0, H.corners[2][0] + 20, H.corners[2][1], w, h, 2).kind, 'corner');   // handles keep their on-screen size
});

test('applyDrag: move, rotate and zoom', () => {
  const q = sq();
  nearQ(applyDrag('move', 0, q, [0.6, 0.5], [0.5, 0.5], A), moveQuad(q, 0.1, 0, A));
  const [cx, cy] = centroid(q, A);
  const r = applyDrag('rotate', 0, q, [cx / A, cy - 0.3], [cx / A + 0.3 / A, cy], A);   // from the right to above: a quarter turn
  nearQ(r, rotateQuad(q, -Math.PI / 2, A));
  const z = applyDrag('zoom', 0, q, [cx / A, cy + 0.4], [cx / A, cy + 0.2], A);
  near(sizeOf(z, A), 0.8);
  assert.deepEqual(applyDrag('zoom', 0, q, [0.9, 0.9], [cx / A, cy], A), q);              // started on the centre: no scale
});

test('sanitizeQuad: clamps, rounds and refuses nonsense', () => {
  assert.equal(sanitizeQuad(null), null);
  assert.equal(sanitizeQuad([[0, 0], [1, 0], [1, 1]]), null);
  assert.equal(sanitizeQuad([[0, 0], [1, 0], [1, 1], ['a', 1]]), null);
  assert.equal(sanitizeQuad([[0, 0], [1, 0], [1, NaN], [0, 1]]), null);
  assert.equal(sanitizeQuad([[0, 0], [0, 0], [0, 0], [0, 0]]), null);
  assert.equal(sanitizeQuad([[0.1, 0.1], [0.1, 0.1], [0.2, 0.2], [0.2, 0.2]]), null);
  assert.deepEqual(sanitizeQuad([[-9, -9], [9, -9], [9, 9], [-9, 9]]), [[-0.5, -0.5], [1.5, -0.5], [1.5, 1.5], [-0.5, 1.5]]);
  assert.deepEqual(sanitizeQuad([[0.123456, 0.2], [0.6, 0.2], [0.6, 0.7], [0.1, 0.7]])[0], [0.1235, 0.2]);
});

test('default grid: one pumpkin is centred, two sit side by side, all are valid', () => {
  const g = gridQuads(1, A, { x: 0, y: 0, size: 0.8 })[0];
  near(centroid(g, A)[0], 0.5 * A, 1e-3); near(sizeOf(g, A), 0.8, 1e-3);
  const two = gridQuads(2, A, { x: 0, y: 0, size: 0.8 });
  assert.ok(two[0][1][0] <= two[1][0][0] + 1e-6);
  assert.equal(gridQuads(6, A, { x: 0, y: 0, size: 0.8 }).length, 6);
  assert.ok(gridQuads(8, A, { x: 1, y: 1, size: 3 }).every((q) => isValid(q, A)));
});

test('group move and scale keep every quad valid and all-or-nothing', () => {
  const qs = gridQuads(3, A, { x: 0, y: 0, size: 0.8 });
  nearQ(moveAll(qs, 0.05, 0.02)[1], moveQuad(qs[1], 0.05, 0.02, A));
  assert.ok(moveAll(qs, 50, 0).every((q) => isValid(q, A)));
  assert.notEqual(scaleAll(qs, 0.5, [0.5, 0.5], A), qs);
  assert.equal(scaleAll(qs, 99, [0.5, 0.5], A), qs);
});

test('perspective weights: a parallelogram is flat, a trapezoid is not', () => {
  assert.deepEqual(quadQ([[0, 0], [1, 0], [1, 1], [0, 1]]).map((v) => Math.round(v * 1e6) / 1e6), [2, 2, 2, 2]);
  const q = quadQ([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]);
  assert.ok(q[2] !== q[0]);
  assert.deepEqual(quadQ([[0, 0], [1, 1], [1, 1], [0, 0]]), [1, 1, 1, 1]);   // degenerate: no weights
});

test('mirror and flip: pointer mapping table', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  const at = (flags) => pointerToStage(150, 100, rect, flags);          // an eighth across, a quarter down
  assert.deepEqual(at({}), { u: 0.125, v: 0.25 });
  assert.deepEqual(at({ mirror: true }), { u: 0.875, v: 0.25 });                // mirror: x inverted
  assert.deepEqual(at({ flip: true }), { u: 0.875, v: 0.75 });                  // flip (half turn): x and y inverted
  assert.deepEqual(at({ mirror: true, flip: true }), { u: 0.125, v: 0.75 });    // both: y only
  assert.deepEqual(pointerToStage(100, 50, rect), { u: 0, v: 0 });
  assert.deepEqual(pointerToStage(1, 1, { left: 0, top: 0, width: 0, height: 0 }), { u: 0.5, v: 0.5 });
  assert.deepEqual(viewSigns({ mirror: true, flip: true }), { invertX: false, invertY: true });
  assert.deepEqual(viewDelta(3, 4, { flip: true }), [-3, -4]);
  assert.deepEqual(viewDelta(3, 4, { mirror: true }), [-3, 4]);
  assert.deepEqual(viewDelta(3, 4, {}), [3, 4]);
});

test('on-screen size and tile size', () => {
  near(screenSize(sq(), 1600, 900), 0.4 * 900);
  assert.equal(tileSize(10), 128);
  assert.equal(tileSize(300), 384);
  assert.equal(tileSize(500), 512);
  assert.equal(tileSize(600), 768);
  assert.equal(tileSize(5000), 1024);
});
