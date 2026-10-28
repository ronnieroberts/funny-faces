// Draws all the pumpkins onto the page's canvas. Used by the main screen and by display screens, so both look the same.
// Each face is drawn flat into a small tile, then the GPU warps the tile onto the pumpkin's quad (see glstage.js).
import { drawFace } from './facepack.js';
import { GLStage } from './glstage.js';
import { screenSize } from './quad.js';

const TILES = [128, 192, 256, 384, 512, 768, 1024];

/** Tile size in pixels for a pumpkin that is `px` pixels across on screen: no bigger than needed, 512 at most
 *  until the pumpkin itself is bigger than that. Fixed steps, so zooming does not reallocate on every frame. */
export function tileSize(px) {
  const want = px * 0.9;
  return TILES.find((s) => s >= want) || TILES[TILES.length - 1];
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas; this.tiles = []; this.state = []; this.ctx = null; this.gl = null;
    try { this.gl = new GLStage(canvas); this.mode = 'webgl2'; }
    catch { this.ctx = canvas.getContext('2d'); this.mode = '2d'; }   // no WebGL2: faces are drawn flat, without perspective
  }

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
    const c = this.canvas, many = pumpkins.length > 1, items = [];
    pumpkins.forEach((p, i) => {
      const m = mouths[i] || { open: 0, bright: 0.5, energy: 0 };
      const st = this.state[i] || (this.state[i] = { blinkAt: t + 1 + Math.random() * 3, blink: 0, lastLoud: -9 });
      if (t > st.blinkAt) { st.blink = 1; st.blinkAt = t + 2 + Math.random() * 4; }
      st.blink = Math.max(0, st.blink - dt * 7);
      if (m.open > 0.05 || m.energy > 0.05) st.lastLoud = t;
      const active = t - st.lastLoud < 0.3 ? 1 : 0;
      const alpha = many ? look.idleDim + (1 - look.idleDim) * active : 1;     // a quiet pumpkin dims when others talk
      const px = tileSize(screenSize(p.quad, c.width, c.height));
      const tile = this.tiles[i] || (this.tiles[i] = document.createElement('canvas'));
      if (tile.width !== px) tile.width = tile.height = px;
      drawFace(tile.getContext('2d'), p.face, px, { open: m.open, bright: m.bright, blink: st.blink > 0.5 ? 1 : st.blink * 2,
        energy: m.energy, color: p.color || look.color, glow: look.glow, alpha, time: t });
      items.push({ key: i, canvas: tile, quad: p.quad });
    });
    this.tiles.length = this.state.length = pumpkins.length;
    if (this.gl) { this.gl.trim(pumpkins.length); this.gl.draw(items); return; }
    this.clear();
    for (const it of items) this.drawFlat(it);
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
