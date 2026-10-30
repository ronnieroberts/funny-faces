// Draws all the pumpkins onto the page's canvas. Used by the main screen and by display screens, so both look the same.
// Each face is drawn flat into a small tile, then the GPU warps the tile onto the pumpkin's quad (see glstage.js).
import { drawFace } from './facepack.js';
import { GLStage } from './glstage.js';
import { screenSize, mirrorQuad } from './quad.js';
import { LEVELS, Governor, tileSize, tileCap, tileKey, keyChanged, flameTime } from './quality.js';

const flameFaces = new WeakMap();
/** True when the face has flames or fire, so its picture changes with time even when nobody speaks. */
const burns = (face) => {
  let b = flameFaces.get(face);
  if (b === undefined) { b = face.layers.some((l) => l.flame || l.fire); flameFaces.set(face, b); }
  return b;
};

export class Stage {
  constructor(canvas) {
    this.canvas = canvas; this.perf = { tile: 0, gl: 0 }; this.tiles = []; this.state = []; this.ctx = null; this.gl = null;
    this.items = []; this.keyBuf = new Array(11).fill(0); this.st = {};
    this.quality = 'auto'; this.governor = new Governor(); this.level = 0;
    this.lever = { skip: true, cap: true, upload: true, glow: true, detail: true };   // switched off one by one by the benchmark, to measure each
    try { this.gl = new GLStage(canvas); this.mode = 'webgl2'; }
    catch { this.ctx = canvas.getContext('2d'); this.mode = '2d'; }   // no WebGL2: faces are drawn flat, without perspective
  }

  /** 'auto' follows the measured frame rate (see watch); 'full' and 'lite' force a level. */
  setQuality(q) {
    this.quality = q === 'full' || q === 'lite' ? q : 'auto';
    this.level = this.quality === 'full' ? 0 : this.quality === 'lite' ? LEVELS.length - 1 : this.governor.level;
  }

  /** Tell the stage how long the last frame took (ms between frames) so Auto can step quality down or up. */
  watch(frameMs, now) {
    if (this.quality === 'auto') this.level = this.governor.update(frameMs, now);
  }

  /** Wait for the GPU (the benchmark only). */
  finish() { if (this.gl) this.gl.sync(); }

  fit() {
    const dpr = Math.min(2, devicePixelRatio || 1), c = this.canvas;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  clear() {
    this.fit();
    if (this.gl) this.gl.clear();
    else if (this.ctx) { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
  }

  /** pumpkins: [{face, quad, color}] with face objects and quad corners as stage fractions;
   *  mouths: one {open, bright, energy} each; look: {color, glow, idleDim}; t, dt in seconds. */
  draw(pumpkins, mouths, look, t, dt) {
    this.fit();
    const T0 = performance.now();
    const c = this.canvas, n = pumpkins.length, many = n > 1, items = this.items, L = this.lever, lv = LEVELS[this.level];
    const cap = L.cap ? tileCap(n, this.level) : 1024, hz = L.skip ? lv.flameHz : 60, st = this.st;
    for (let i = 0; i < n; i++) {
      const p = pumpkins[i], m = mouths[i] || { open: 0, bright: 0.5, energy: 0 };
      const ps = this.state[i] || (this.state[i] = { blinkAt: t + 1 + Math.random() * 3, blink: 0, lastLoud: -9 });
      if (t > ps.blinkAt) { ps.blink = 1; ps.blinkAt = t + 2 + Math.random() * 4; }
      ps.blink = Math.max(0, ps.blink - dt * 7);
      if (m.open > 0.05 || m.energy > 0.05) ps.lastLoud = t;
      const active = t - ps.lastLoud < 0.3 ? 1 : 0;
      const px = tileSize(screenSize(p.quad, c.width, c.height), cap), color = p.color || look.color;
      const tile = this.tiles[i] || (this.tiles[i] = document.createElement('canvas'));
      const resized = tile.width !== px;
      if (resized) tile.width = tile.height = px;
      st.open = m.open; st.bright = m.bright; st.energy = m.energy; st.color = color; st.glow = look.glow; st.level = this.level; st.sad = look.sad || 0;
      st.blink = ps.blink > 0.5 ? 1 : ps.blink * 2;
      st.alpha = many ? look.idleDim + (1 - look.idleDim) * active : 1;     // a quiet pumpkin dims when others talk
      const flame = burns(p.face), key = tileKey(this.keyBuf, st, px, flame, hz, t, i, color);
      const dirty = resized || !L.skip || keyChanged(tile.key, key);
      if (dirty) {
        tile.key = key.slice();
        st.time = L.skip && flame ? flameTime(key[7], hz, i) : t;
        st.detail = L.detail ? lv.detail : 1; st.shadow = lv.glow; st.cheapGlow = L.glow;
        drawFace(tile.getContext('2d'), p.face, px, st);
      }
      const it = items[i] || (items[i] = {});
      it.key = i; it.canvas = tile; it.dirty = dirty || !L.upload;
      if (it.src !== p.quad || it.mir !== !!p.mirror) { it.src = p.quad; it.mir = !!p.mirror; it.quad = it.mir ? mirrorQuad(p.quad) : p.quad; }   // mirrored: swap left and right corners, so the picture flips and the place stays
    }
    this.tiles.length = this.state.length = items.length = n;
    const T1 = performance.now();
    if (this.gl) { this.gl.trim(n); this.gl.draw(items); }
    else { this.clear(); for (const it of items) this.drawFlat(it); }
    this.perf.tile += T1 - T0; this.perf.gl += performance.now() - T1;
  }

  /** The no-WebGL fallback: the tile's top-left, top-right and bottom-left corners are matched, so it moves, scales and
   *  rotates with the quad (a skewed quad becomes a parallelogram; there is no perspective). */
  drawFlat({ canvas: tile, quad }) {
    const { width: w, height: h } = this.canvas, [a, b, , d] = quad.map(([x, y]) => [x * w, y * h]), n = tile.width;
    this.ctx.setTransform((b[0] - a[0]) / n, (b[1] - a[1]) / n, (d[0] - a[0]) / n, (d[1] - a[1]) / n, a[0], a[1]);
    this.ctx.drawImage(tile, 0, 0);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
