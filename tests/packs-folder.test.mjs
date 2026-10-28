import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { listPacks, readPack } from '../server/packs.js';
import { STARTER_PACK } from '../src/facepack.js';
import { mergePacks, loadFolderPacks, addPack, builtIn } from '../src/packs.js';

const pack = (id) => ({ ...STARTER_PACK, id, name: id });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ff-packs-')), packs = join(dir, 'packs');
  mkdirSync(packs); mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/index.html'), '<title>app</title>');
  return { dir, packs };
}
function get(port, path, { host, headers = {}, method = 'GET' } = {}) {
  return new Promise((ok, fail) => {
    const req = http.request({ port, path, method, host: '127.0.0.1', headers: { host: host || `localhost:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', fail); req.end();
  });
}
async function boot(s, opts = {}) {
  const app = createApp({ port: 0, host: '127.0.0.1', dataDir: join(s.dir, 'data'), distDir: join(s.dir, 'dist'), packsDir: s.packs, ...opts });
  return { app, port: await app.listen() };
}

test('lists only *.json, sorted, and serves a listed file exactly', async () => {
  const s = setup();
  writeFileSync(join(s.packs, 'b.json'), JSON.stringify(pack('b')));
  writeFileSync(join(s.packs, 'a.json'), JSON.stringify(pack('a')));
  writeFileSync(join(s.packs, 'README.txt'), 'hi'); writeFileSync(join(s.packs, '.hidden.json'), '{}');
  mkdirSync(join(s.packs, 'dir.json'));
  const { app, port } = await boot(s);
  try {
    const r = await get(port, '/api/packs');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { files: ['a.json', 'b.json'], skipped: [] });
    const f = await get(port, '/api/packs/a.json');
    assert.equal(f.status, 200); assert.equal(f.headers['content-type'], 'application/json');
    assert.equal(JSON.parse(f.body).id, 'a');
    assert.equal((await get(port, '/api/packs/README.txt')).status, 404);
    assert.equal((await get(port, '/api/packs/nope.json')).status, 404);
  } finally { await app.close(); }
});

test('a missing folder is an empty list', async () => {
  const s = setup();
  const { app, port } = await boot(s, { packsDir: join(s.dir, 'nothing-here') });
  try { assert.deepEqual(JSON.parse((await get(port, '/api/packs')).body), { files: [], skipped: [] }); } finally { await app.close(); }
});

test('path traversal and unlisted names are refused', async () => {
  const s = setup();
  writeFileSync(join(s.packs, 'a.json'), '{}'); writeFileSync(join(s.dir, 'secret.json'), '{"x":1}');
  const { app, port } = await boot(s);
  try {
    for (const p of ['/api/packs/..%2fsecret.json', '/api/packs/../secret.json', '/api/packs/%2e%2e/secret.json', '/api/packs/a.json%00', '/api/packs/%ZZ', '/api/packs/sub/a.json']) {
      const r = await get(port, p);
      assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!r.body.includes('"x"'));
    }
    assert.equal(readPack(s.packs, '../secret.json'), null);
    assert.equal(readPack(s.packs, join(s.dir, 'secret.json')), null);
  } finally { await app.close(); }
});

test('oversize files and extra files are skipped with a reason, and no path is leaked', async () => {
  const s = setup();
  writeFileSync(join(s.packs, 'big.json'), Buffer.alloc(2 * 1024 * 1024 + 1, 32));
  for (let i = 0; i < 22; i++) writeFileSync(join(s.packs, `p${String(i).padStart(2, '0')}.json`), '{}');
  const { app, port } = await boot(s);
  try {
    const r = JSON.parse((await get(port, '/api/packs')).body);
    assert.equal(r.files.length, 20);
    assert.ok(!r.files.includes('big.json'));
    assert.ok(r.skipped.some((k) => k.file === 'big.json' && /too large/.test(k.reason)));
    assert.equal(r.skipped.length, 3);                                                 // big.json plus two over the limit of 20
    assert.equal((await get(port, '/api/packs/big.json')).status, 404);
    assert.ok(!JSON.stringify(r).includes(s.dir));
    assert.ok(!(await get(port, '/api/packs/big.json')).body.includes(s.dir));
  } finally { await app.close(); }
});

test('symlinks inside the folder work; symlinks that leave it are skipped', async () => {
  const s = setup();
  writeFileSync(join(s.packs, 'real.json'), JSON.stringify(pack('real'))); writeFileSync(join(s.dir, 'outside.json'), JSON.stringify(pack('out')));
  symlinkSync(join(s.packs, 'real.json'), join(s.packs, 'inner.json'));
  symlinkSync(join(s.dir, 'outside.json'), join(s.packs, 'escape.json'));
  symlinkSync(join(s.dir, 'nowhere.json'), join(s.packs, 'dangling.json'));
  const { app, port } = await boot(s);
  try {
    const r = JSON.parse((await get(port, '/api/packs')).body);
    assert.deepEqual(r.files, ['inner.json', 'real.json']);
    assert.deepEqual(r.skipped.map((k) => k.file).sort(), ['dangling.json', 'escape.json']);
    assert.equal((await get(port, '/api/packs/escape.json')).status, 404);
    assert.equal((await get(port, '/api/packs/inner.json')).status, 200);
    assert.ok(!JSON.stringify(r).includes(s.dir));
  } finally { await app.close(); }
});

test('same gating as the control page: other hosts, other origins and other methods are refused', async () => {
  const s = setup();
  writeFileSync(join(s.packs, 'a.json'), '{}');
  const { app, port } = await boot(s);
  try {
    assert.equal((await get(port, '/api/packs', { host: `192.168.1.9:${port}` })).status, 403);
    assert.equal((await get(port, '/api/packs/a.json', { host: `192.168.1.9:${port}` })).status, 403);
    assert.equal((await get(port, '/api/packs', { headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await get(port, '/api/packs', { method: 'POST' })).status, 403);
    assert.equal((await get(port, '/api/packs', { method: 'DELETE' })).status, 403);
    assert.equal((await get(port, '/api/packs', { headers: { origin: `http://localhost:${port}` } })).status, 200);
  } finally { await app.close(); }
});

test('listPacks is stable across calls and reads new files at once', () => {
  const s = setup();
  assert.deepEqual(listPacks(s.packs).files, []);
  writeFileSync(join(s.packs, 'x.json'), '{}');
  assert.deepEqual(listPacks(s.packs).files, ['x.json']);
});

// ---- the page side
test('mergePacks: folder wins over stored with the same id, built-in id stays reserved', () => {
  const stored = [pack('mine'), pack('same')], folder = [{ ...pack('same'), name: 'from folder' }, pack('other')];
  const m = mergePacks(stored, folder);
  assert.deepEqual(m.map((p) => p.id), ['mine', 'same', 'other']);
  assert.equal(m.find((p) => p.id === 'same').name, 'from folder');
  assert.equal(m.find((p) => p.id === 'same'), folder[0]);
  assert.deepEqual(mergePacks([{ ...pack('x'), id: builtIn().id }], []).length, 0);
  assert.throws(() => addPack([], pack('same'), folder), /packs folder/);
  assert.equal(addPack([], pack('free'), folder).length, 1);
});

function fakeFetch(files, listExtra = {}) {
  return async (url) => {
    if (url === '/api/packs') return { ok: true, json: async () => ({ files: Object.keys(files), skipped: [], ...listExtra }) };
    const name = decodeURIComponent(url.replace('/api/packs/', ''));
    return name in files ? { ok: true, text: async () => files[name] } : { ok: false };
  };
}

test('loadFolderPacks keeps good packs and reports each bad one with its file name and reason', async () => {
  const dupe = JSON.stringify(pack('good')), reserved = JSON.stringify(pack(builtIn().id));
  const r = await loadFolderPacks(fakeFetch({ 'good.json': dupe, 'broken.json': '{nope', 'copy.json': dupe, 'reserved.json': reserved, 'bad.json': '{"format":"x"}' },
    { skipped: [{ file: 'huge.json', reason: 'too large (over 2 MB)' }] }));
  assert.deepEqual(r.packs.map((p) => p.id), ['good']);
  const by = Object.fromEntries(r.problems.map((p) => [p.file, p.reason]));
  assert.match(by['huge.json'], /too large/);
  assert.match(by['broken.json'], /not valid JSON/);
  assert.match(by['copy.json'], /good\.json/);
  assert.match(by['reserved.json'], /reserved/);
  assert.ok(by['bad.json']);
  assert.equal(r.problems.length, 5);
});

test('loadFolderPacks gives nothing, quietly, when there is no server API', async () => {
  assert.deepEqual(await loadFolderPacks(async () => ({ ok: false })), { packs: [], problems: [] });
  assert.deepEqual(await loadFolderPacks(async () => { throw new Error('offline'); }), { packs: [], problems: [] });
});

test('the release zip and Docker image get the packs folder; only its README is tracked', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const f = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.match(f('scripts/make-release.mjs'), /packs\/README\.txt/);
  assert.match(f('Dockerfile'), /FACES_PACKS_DIR=\/data\/packs/);
  assert.ok(existsSync(new URL('../packs/README.txt', import.meta.url)));
  assert.match(f('.gitignore'), /^!packs\/README\.txt$/m);
});
