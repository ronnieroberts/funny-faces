// Static checks on the release workflow, the release script and the Dockerfile (nothing here needs Docker or the network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

test('workflow: the tag is only passed through env, never interpolated into shell', () => {
  const lines = read('.github/workflows/release.yml').split('\n');
  const uses = lines.filter((l) => /\$\{\{\s*github\.ref_name\s*\}\}/.test(l) && !/^\s*#/.test(l));
  assert.ok(uses.length >= 2);
  for (const l of uses) assert.match(l, /^\s+TAG:\s*\$\{\{ github\.ref_name \}\}\s*$/, l);
});

test('workflow: refuses a tag that does not match package.json, and publishes SHA256SUMS', () => {
  const y = read('.github/workflows/release.yml');
  assert.match(y, /package\.json/);
  assert.match(y, /s\/-rc\[0-9\]\+\$\//);
  assert.match(y, /exit 1/);
  assert.match(y, /sha256sum \*\.zip > SHA256SUMS/);
  assert.match(y, /release\/SHA256SUMS/);
});

test('workflow: every action is pinned to a full commit SHA', () => {
  for (const m of read('.github/workflows/release.yml').matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
});

test('the tag-to-version rule behaves (v1.0.1 and v1.0.1-rc2 match 1.0.1; v1.0.2 does not)', () => {
  const norm = (t) => t.replace(/^v/, '').replace(/-rc[0-9]+$/, '');
  assert.equal(norm('v1.0.1'), '1.0.1'); assert.equal(norm('v1.0.1-rc2'), '1.0.1'); assert.notEqual(norm('v1.0.2'), '1.0.1');
});

test('release script ships Node licence and third-party notices', () => {
  const s = read('scripts/make-release.mjs');
  assert.match(s, /LICENSE-node\.txt/);
  assert.match(s, /THIRD-PARTY-NOTICES\.txt/);
  assert.ok(!/LICENSE['"`]?\)?, *join\(root, *['"]LICENSE['"]\)/.test(s), 'no project LICENSE is added: the owner has not chosen one');
});

test('Dockerfile: /data is created and owned by node before VOLUME; healthcheck uses node, not curl; runs as node', () => {
  const d = read('Dockerfile');
  const own = d.indexOf('chown node:node /data'), vol = d.indexOf('VOLUME /data'), user = d.indexOf('USER node');
  assert.ok(own > 0 && vol > own && user > vol);
  assert.match(d, /HEALTHCHECK[\s\S]*"node", "-e"[\s\S]*\/api\/info/);
  assert.ok(!/curl|wget/.test(d));
});
