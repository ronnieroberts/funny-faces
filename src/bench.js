// Render benchmark: open the app with ?bench=1. It draws n pumpkins with the flame face at full-screen size, each
// talking with its own made-up voice, and reports the time per frame split into drawing the face tiles and
// uploading/drawing them with WebGL. Result: window.__bench (also printed in the status line).
import { gridQuads, screenSize } from './quad.js';
const COUNTS = (new URLSearchParams(location.search).get('n') || '1,4,8').split(",").map(Number);
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/** Statistics of a list of millisecond values. */
export function summarize(list) {
  const a = [...list].sort((x, y) => x - y);
  const avg = a.reduce((s, v) => s + v, 0) / (a.length || 1);
  return { avg: +avg.toFixed(2), p95: +(a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] || 0).toFixed(2), n: a.length };
}

/** n quads placed like the app's default row or grid (the group fills 80% of the stage). */
const layout = (n, W, H) => gridQuads(n, W / H, { x: 0, y: 0, size: 0.8 });

/** Run one setting: warm up, then measure `frames` frames. `talk` false = every pumpkin is quiet. */
export async function measure(stage, face, n, { frames = 150, warm = 20, talk = true, quality = 'full' } = {}) {
  stage.setQuality && stage.setQuality(quality);
  stage.fit();
  const quads = layout(n, stage.canvas.width, stage.canvas.height);
  const px = quads.map((q) => screenSize(q, stage.canvas.width, stage.canvas.height) | 0);
  const pumpkins = quads.map((quad) => ({ face, quad, color: '#ff8a1f' }));
  const look = { color: '#ff8a1f', glow: 0.8, idleDim: 0.5 };
  const total = [], tile = [], gl = [], gap = [];
  let prev = performance.now();
  for (let f = 0; f < frames + warm; f++) {
    await nextFrame();
    const now = performance.now(), t = now / 1000;
    const mouths = pumpkins.map((_, i) => talk
      ? { open: Math.max(0, Math.sin(t * 7 + i * 1.3)) * 0.8, bright: 0.5 + 0.4 * Math.sin(t * 1.7 + i), energy: Math.max(0, Math.sin(t * 7 + i * 1.3)) }
      : { open: 0, bright: 0.5, energy: 0 });
    stage.perf.tile = stage.perf.gl = 0;
    const a = performance.now();
    stage.draw(pumpkins, mouths, look, t, Math.min(0.1, (now - prev) / 1000));
    stage.finish && stage.finish();                // wait for the GPU, so the GL part is real
    const b = performance.now();
    if (f >= warm) { total.push(b - a); tile.push(stage.perf.tile); gl.push(b - a - stage.perf.tile); gap.push(now - prev); }
    prev = now;
  }
  const g = summarize(gap), w = summarize(total);
  return { n, px: px[0], quality, talk, work: w, tile: summarize(tile), gl: summarize(gl), frameGap: g, fps: +(1000 / Math.max(g.avg, w.avg)).toFixed(1) };
}

export async function runBench(stage, face, params) {
  for (const k of (params.get('off') || '').split(',')) if (k) stage.lever[k] = false;   // ?off=skip,cap,upload,glow,detail: measure without a lever
  stage.fit();
  const out = { size: [stage.canvas.width, stage.canvas.height], mode: stage.mode, rows: [] };
  window.__benchProgress = 'running';
  for (const quality of (params.get('q') || 'full,lite').split(','))
    for (const n of COUNTS) for (const talk of [true, false]) { out.rows.push(await measure(stage, face, n, { quality, talk })); window.__bench = out; }
  stage.setQuality && stage.setQuality('auto');
  window.__bench = out; window.__benchProgress = 'done';
  return out;
}
