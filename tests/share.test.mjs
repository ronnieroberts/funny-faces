import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, parseState, packMouth, unpackMouth, isNewer, changed } from '../src/share.js';
import { builtIn } from '../src/packs.js';
import { loadConfig } from '../src/relay.js';
import { DEFAULTS } from '../src/settings.js';

const face = builtIn().faces[0];

test('state survives the trip and is re-validated', () => {
  const s = parseState(JSON.parse(JSON.stringify(buildState({ ...DEFAULTS, color: '#00ff00', size: 1.2 }, face))));
  assert.equal(s.color, '#00ff00');
  assert.equal(s.size, 1.2);
  assert.equal(s.face.id, face.id);
  assert.ok(s.face.layers.length > 0);
});
test('hostile or broken state is refused or clamped', () => {
  assert.equal(parseState(null), null);
  assert.equal(parseState({ face: null }), null);
  assert.equal(parseState({ face: { layers: [{ kind: 'evil' }] } }), null);
  const s = parseState({ ...buildState(DEFAULTS, face), size: 9999, color: 'url(x)', x: 'a' });
  assert.equal(s.size, 3);
  assert.equal(s.color, DEFAULTS.color);
  assert.equal(s.x, DEFAULTS.x);
});
test('mouth values pack to bytes and back', () => {
  assert.deepEqual(packMouth({ open: 1, bright: 0, energy: 0.5 }), [255, 0, 128]);
  assert.deepEqual(packMouth({ open: 5, bright: -1, energy: 0 }), [255, 0, 0]);
  assert.equal(unpackMouth([255, 0, 51]).open, 1);
  assert.equal(unpackMouth([1, 2]), null);
  assert.equal(unpackMouth([1, 2, 300]), null);
  assert.equal(unpackMouth('abc'), null);
});
test('old messages are ignored, unnumbered ones accepted', () => {
  assert.equal(isNewer(5, 4), true);
  assert.equal(isNewer(4, 4), false);
  assert.equal(isNewer(3, 4), false);
  assert.equal(isNewer(undefined, 4), true);
});
test('repeats are not worth sending', () => {
  assert.equal(changed(null, [0, 0, 0]), true);
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
