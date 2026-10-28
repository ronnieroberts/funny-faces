// A small QR code encoder (byte mode, error correction level M, versions 1 to 10: up to 213 bytes), no dependencies.
// Used to show the TV address as a QR code. qrMatrix() gives rows of booleans (true = dark); qrSvg() draws it.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data, deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) {
    const n = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], EXP[i]); }
    g = n;
  }
  const res = new Array(deg).fill(0);
  for (const d of data) {
    const f = d ^ res.shift();
    res.push(0);
    for (let i = 0; i < deg; i++) res[i] ^= mul(g[i + 1], f);
  }
  return res;
}

// Level M, per version: [error codewords per block, blocks of the first size, data per block, blocks of the larger size]
const M_BLOCKS = [null, [10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0], [16, 4, 27, 0],
  [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const dataBytes = (v) => { const [, a, da, b] = M_BLOCKS[v]; return a * da + b * (da + 1); };
const bit = (n, i) => ((n >>> i) & 1) === 1;

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1;
  while (v <= 10 && bytes.length + 2 + (v >= 10 ? 1 : 0) > dataBytes(v)) v++;
  if (v > 10) throw new Error('Text is too long for this QR code');

  // bit stream: mode (byte), length, data, terminator, padding
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push(bit(val, i) ? 1 : 0); };
  put(4, 4); put(bytes.length, v >= 10 ? 16 : 8);
  for (const b of bytes) put(b, 8);
  const cap = dataBytes(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataBytes(v); pad ^= 0xec ^ 0x11) data.push(pad);

  // split into blocks, add error correction, interleave
  const [ec, a, da, b] = M_BLOCKS[v];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < a + b; i++) {
    const len = i < a ? da : da + 1;
    const d = data.slice(at, at + len);
    at += len;
    blocks.push({ d, e: rsRemainder(d, ec) });
  }
  const all = [];
  for (let i = 0; i <= da; i++) for (const bl of blocks) if (i < bl.d.length) all.push(bl.d[i]);
  for (let i = 0; i < ec; i++) for (const bl of blocks) all.push(bl.e[i]);

  const n = 4 * v + 17;
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < n && y < n) { mod[y][x] = dark; fn[y][x] = true; } };

  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }          // timing
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
  const pos = ALIGN[v];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mask) => {                                     // level M = 00
    const d = mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits15 = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits15, i));
    set(8, 7, bit(bits15, 6)); set(8, 8, bit(bits15, 7)); set(7, 8, bit(bits15, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits15, i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(bits15, i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(bits15, i));
    set(8, n - 8, true);
  };
  format(0);
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits18 = (v << 12) | rem;
    for (let i = 0; i < 18; i++) { const c = bit(bits18, i), p = n - 11 + (i % 3), q = Math.floor(i / 3); set(p, q, c); set(q, p, c); }
  }

  // data, zigzag from the bottom right, skipping the vertical timing column
  let k = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!fn[y][x] && k < all.length * 8) { mod[y][x] = bit(all[k >> 3], 7 - (k & 7)); k++; }
      }
    }
  }

  const maskFns = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  let best = null, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && maskFns[m](x, y)) mod[y][x] = !mod[y][x];
    format(m);
    const s = penalty(mod);
    if (s < bestScore) { bestScore = s; best = mod.map((r) => r.slice()); }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && maskFns[m](x, y)) mod[y][x] = !mod[y][x];
  }
  return best;
}

function penalty(m) {
  const n = m.length;
  let p = 0, dark = 0;
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(m[i].map((c) => (c ? '1' : '0')).join(''), m.map((r) => (r[i] ? '1' : '0')).join(''));
  for (const s of lines) {
    for (const run of s.match(/0+|1+/g)) if (run.length >= 5) p += 3 + run.length - 5;
    for (const pat of ['10111010000', '00001011101']) for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) p += 40;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  return p + 10 * (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1);
}

/** SVG markup (black on white, with the 4 module quiet zone a phone camera needs). */
export function qrSvg(text, size = 220) {
  const m = qrMatrix(text), n = m.length, q = 4;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for the TV address"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
