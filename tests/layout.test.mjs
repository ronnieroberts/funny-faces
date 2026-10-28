import test from 'node:test';
import assert from 'node:assert/strict';
import { placement, drag, scale, nudge } from '../src/layout.js';
import { addPack, removePack, findFace, allFaces, parsePack, builtIn, loadPacks, savePacks } from '../src/packs.js';

const L = { x: 0, y: 0, size: 0.8 };

test('centred face sits in the middle of the window', () => {
  const p = placement(1920, 1080, L);
  assert.equal(p.s, 864);
  assert.equal(p.left + p.s / 2, 960);
  assert.equal(p.top + p.s / 2, 540);
});
test('drag moves by the pixels dragged', () => {
  const l = drag(L, 960, 0, 1920, 1080);
  assert.equal(l.x, 1);
  assert.equal(drag(l, 5000, 0, 1920, 1080).x, 1);   // clamped to the window edge
});
test('scale is clamped', () => {
  assert.equal(scale(L, 100).size, 3);
  assert.equal(scale(L, 0.0001).size, 0.1);
  assert.equal(nudge(L, 5, -5).y, -1);
});

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const pack = (id) => JSON.stringify({ format: 'pumpkin-face-pack', version: 1, id, name: id, faces: [
  { id: 'a', name: 'A', layers: [{ kind: 'shape', points: [[10, 10], [20, 10], [15, 20]] }] }] });

test('packs: add, replace, reject reserved id, remove', () => {
  let packs = addPack([], parsePack(pack('mine')));
  packs = addPack(packs, parsePack(pack('mine')));
  assert.equal(packs.length, 1);
  assert.throws(() => addPack(packs, builtIn()), /reserved/);
  assert.equal(removePack(packs, 'mine').length, 0);
});
test('packs: bad files are rejected', () => {
  assert.throws(() => parsePack('{nope'), /not valid JSON/);
  assert.throws(() => parsePack('{"format":"x"}'), /Not a Funny Faces face pack/);
  assert.throws(() => parsePack('x'.repeat(3 * 1024 * 1024)), /too large/);
});
test('packs: stored and found by key or bare id', () => {
  const st = mem();
  savePacks([parsePack(pack('mine'))], st);
  const list = allFaces(loadPacks(st));
  assert.equal(findFace(list, 'mine/a').face.id, 'a');
  assert.equal(findFace(list, 'classic').key, 'starter/classic');
  assert.equal(findFace(list, 'nothing').key, list[0].key);
});
