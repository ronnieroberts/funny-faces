// Power spectrum of a block of samples (radix-2 FFT with a Hann window). Used for songs analysed in the browser.
export function powerSpectrum(samples, start, size, out) {
  const re = new Float32Array(size), im = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const s = start + i < samples.length ? samples[start + i] : 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  for (let i = 1, j = 0; i < size; i++) {                 // bit-reversal order
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < size; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const n = size / 2, res = out || new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = (re[i] * re[i] + im[i] * im[i]) / (size * size);
  return res;
}
