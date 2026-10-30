import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, parseState, packMouth, mouthFrame, parseMouth, isNewer, isNewer16, changed } from '../src/share.js';
import { builtIn } from '../src/packs.js';
import { loadConfig } from '../src/relay.js';
import { DEFAULTS } from '../src/settings.js';

const face = builtIn().faces[0];

const faceFor = () => face;
const Q = [[0.1, 0.2], [0.4, 0.25], [0.45, 0.6], [0.05, 0.55]];
const three = { ...DEFAULTS, pumpkins: [{ ...DEFAULTS.pumpkins[0] }, { ...DEFAULTS.pumpkins[0], quad: Q, color: '#00ff00' }, { ...DEFAULTS.pumpkins[0], enabled: false }] };

test('a mirrored face is sent to the screens as mirrored', () => {
  const m = { ...three, pumpkins: [{ ...three.pumpkins[0], mirror: true }, { ...three.pumpkins[1] }] };
  const s = parseState(JSON.parse(JSON.stringify(buildState(m, faceFor))));
  assert.deepEqual(s.pumpkins.map((p) => p.mirror), [true, false]);
});

test('state survives the trip and is re-validated', () => {
  const s = parseState(JSON.parse(JSON.stringify(buildState({ ...three, color: '#00ff00', size: 1.2 }, faceFor))));
  assert.equal(s.color, '#00ff00');
  assert.equal(s.size, 1.2);
  assert.equal(s.pumpkins.length, 2);                       // the disabled pumpkin is not sent
  assert.equal(s.pumpkins[0].face.id, face.id);
  assert.deepEqual(s.pumpkins[1].quad, Q);   // the warp travels to the screens
  assert.equal(s.pumpkins[1].color, '#00ff00');
  assert.ok(s.pumpkins[0].face.layers.length > 0);
});
test('hostile or broken state is refused or clamped', () => {
  assert.equal(parseState(null), null);
  assert.equal(parseState({ face: null }), null);
  assert.equal(parseState({ pumpkins: [{ face: 'x' }], faces: { x: { layers: [{ kind: 'evil' }] } } }), null);
  assert.equal(parseState({ pumpkins: [{ face: 'missing' }], faces: {} }), null);
  assert.equal(parseState({ pumpkins: [], faces: {} }), null);
  const s = parseState({ ...buildState(three, faceFor), size: 9999, color: 'url(x)', x: 'a' });
  assert.equal(s.size, 3);
  assert.equal(s.color, DEFAULTS.color);
  assert.equal(s.x, DEFAULTS.x);
  const many = buildState({ ...DEFAULTS, pumpkins: Array.from({ length: 20 }, () => ({ ...DEFAULTS.pumpkins[0] })) }, faceFor);
  assert.equal(parseState(many).pumpkins.length, 8);        // never more than eight
});
test('mouth values pack to bytes, one mouth per pumpkin', () => {
  assert.deepEqual(packMouth([{ open: 1, bright: 0, energy: 0.5 }]), [255, 0, 128]);
  assert.deepEqual(packMouth([{ open: 5, bright: -1, energy: 0 }, { open: 0, bright: 1, energy: 1 }]), [255, 0, 0, 0, 255, 255]);
});
test('a mouth frame is 0x4D, a 16 bit sequence, then three bytes per pumpkin, and parses back', () => {
  const f = mouthFrame(0x1234, [255, 0, 51, 1, 2, 3]);
  assert.deepEqual([...f], [0x4d, 0x12, 0x34, 255, 0, 51, 1, 2, 3]);
  const p = parseMouth(f.buffer);                                     // what a browser hands over: an ArrayBuffer
  assert.equal(p.n, 0x1234);
  assert.equal(p.mouths.length, 2);
  assert.equal(p.mouths[0].open, 1);
  assert.equal(p.mouths[0].energy, 51 / 255);
  assert.equal(parseMouth(f).n, 0x1234);                              // a Uint8Array works too
  assert.equal(mouthFrame(65536 + 7, [0, 0, 0])[2], 7);               // the number wraps
  assert.equal(parseMouth(mouthFrame(1, new Array(24).fill(1))).mouths.length, 8);
});
test('bad mouth frames are refused', () => {
  assert.equal(parseMouth(new Uint8Array([0x4d, 0, 1, 1, 2]).buffer), null);          // length
  assert.equal(parseMouth(new Uint8Array([0x4d, 0, 1]).buffer), null);                // no pumpkin
  assert.equal(parseMouth(new Uint8Array([0x4e, 0, 1, 1, 2, 3]).buffer), null);       // type
  assert.equal(parseMouth(mouthFrame(1, new Array(27).fill(1))), null);               // nine pumpkins
  assert.equal(parseMouth('abc'), null);
  assert.equal(parseMouth(null), null);
});
test('the 16 bit sequence is compared across the wrap', () => {
  assert.equal(isNewer16(5, 4), true);
  assert.equal(isNewer16(4, 4), false);
  assert.equal(isNewer16(3, 4), false);
  assert.equal(isNewer16(0, 65535), true);                            // wrapped
  assert.equal(isNewer16(2, 65534), true);
  assert.equal(isNewer16(65535, 0), false);                           // an old one from before the wrap
  assert.equal(isNewer16(65530, 3), false);
  assert.equal(isNewer16(0, -1), true);                               // nothing seen yet
  assert.equal(isNewer16(40000, 0), false);                           // more than half the range ahead counts as behind
});
test('old messages are ignored, unnumbered ones accepted', () => {
  assert.equal(isNewer(5, 4), true);
  assert.equal(isNewer(4, 4), false);
  assert.equal(isNewer(3, 4), false);
  assert.equal(isNewer(undefined, 4), true);
});
test('repeats are not worth sending', () => {
  assert.equal(changed(null, [0, 0, 0]), true);
  assert.equal(changed([10, 10, 10], [10, 10, 10, 0, 0, 0]), true);       // a different number of pumpkins
  assert.equal(changed([10, 10, 10], [11, 10, 10]), false);
  assert.equal(changed([10, 10, 10], [13, 10, 10]), true);
});
test('the relay is the server that served the page', async () => {
  const info = async () => ({ ok: true, json: async () => ({ urls: [] }) });
  assert.equal((await loadConfig(info, { protocol: 'http:', host: '192.168.1.5:8765' })).relay, 'ws://192.168.1.5:8765/ws');
  assert.equal((await loadConfig(info, { protocol: 'https:', host: 'faces.local' })).relay, 'wss://faces.local/ws');
  assert.equal(await loadConfig(info, { protocol: 'file:', host: '' }), null);
  assert.equal(await loadConfig(async () => { throw new Error('offline'); }, { protocol: 'http:', host: 'x' }), null);
  assert.equal(await loadConfig(async () => ({ ok: false }), { protocol: 'http:', host: 'x' }), null);
});

test('a bad quad from the network is replaced, not drawn', () => {
  const st = JSON.parse(JSON.stringify(buildState(three, faceFor)));
  st.pumpkins[1].quad = [[0, 0], [NaN, 0], [1, 1], [0, 1]];
  st.pumpkins[0].quad = [[-99, -99], [99, -99], [99, 99], [-99, 99]];
  const s = parseState(st);
  assert.equal(s.pumpkins[1].quad.length, 4);
  assert.ok(s.pumpkins.every((p) => p.quad.flat().every((n) => Number.isFinite(n) && n >= -0.5 && n <= 1.5)));
});

test('parseState: a face key that names an inherited property is not a face', () => {
  const st = buildState(three, faceFor, 1);
  st.pumpkins[0].face = 'toString';
  assert.equal(parseState(st), null);
});
