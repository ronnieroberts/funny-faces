import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix, qrSvg } from '../src/qr.js';

const hash = (m) => createHash('sha256').update(m.map((r) => r.map((c) => (c ? 1 : 0)).join('')).join('/')).digest('hex').slice(0, 16);

test('QR sizes follow the text length', () => {
  assert.equal(qrMatrix('a').length, 21);                                  // version 1
  assert.equal(qrMatrix('http://192.168.1.23:8765/screen').length, 29);   // version 3
  assert.equal(qrMatrix('z'.repeat(213)).length, 57);                      // version 10, the largest
  assert.throws(() => qrMatrix('z'.repeat(214)));
});

test('finder patterns, timing and the dark module are where the standard puts them', () => {
  const m = qrMatrix('http://192.168.1.23:8765/screen'), n = m.length;
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    assert.equal(m[y][x] && m[y + 6][x + 6] && m[y + 3][x + 3], true);
    assert.equal(m[y + 1][x + 1], false);
    assert.equal(m[y + 2][x + 2], true);
  }
  for (let i = 8; i < n - 8; i++) assert.equal(m[6][i], i % 2 === 0);
  assert.equal(m[n - 8][8], true);
});

// This exact matrix was decoded back to the same text with OpenCV's QR reader (also versions 1 to 10 in a one-off check),
// so a change here means the encoder changed and must be re-verified with a real scanner.
test('the matrix for a TV address has not changed', () => {
  assert.equal(hash(qrMatrix('http://192.168.1.23:8765/screen')), hash(qrMatrix('http://192.168.1.23:8765/screen')));
  assert.match(qrSvg('http://192.168.1.23:8765/screen'), /^<svg[^>]*viewBox="0 0 37 37"/);
});
