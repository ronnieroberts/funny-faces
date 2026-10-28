// Draws all the pumpkins onto the page's canvas. Used by the main screen and by display screens, so both look the same.
import { drawFace } from './facepack.js';
import { placeAll } from './layout.js';

export class Stage {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.tiles = []; this.state = []; }

  fit() {
    const dpr = Math.min(2, devicePixelRatio || 1), c = this.canvas;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  /** pumpkins: [{face, dx, dy, scale, color}] with face objects; mouths: one {open, bright, energy} each;
   *  look: {color, glow, x, y, size, idleDim}; t, dt in seconds. */
  draw(pumpkins, mouths, look, t, dt) {
    this.fit();
    const ctx = this.ctx, c = this.canvas;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const spots = placeAll(c.width, c.height, look, pumpkins), many = pumpkins.length > 1;
    pumpkins.forEach((p, i) => {
      const m = mouths[i] || { open: 0, bright: 0.5, energy: 0 };
      const st = this.state[i] || (this.state[i] = { blinkAt: t + 1 + Math.random() * 3, blink: 0, lastLoud: -9 });
      if (t > st.blinkAt) { st.blink = 1; st.blinkAt = t + 2 + Math.random() * 4; }
      st.blink = Math.max(0, st.blink - dt * 7);
      if (m.open > 0.05 || m.energy > 0.05) st.lastLoud = t;
      const active = t - st.lastLoud < 0.3 ? 1 : 0;
      const alpha = many ? look.idleDim + (1 - look.idleDim) * active : 1;     // a quiet pumpkin dims when others talk
      const px = Math.max(128, Math.min(960, Math.round(spots[i].s)));
      const tile = this.tiles[i] || (this.tiles[i] = document.createElement('canvas'));
      if (tile.width !== px) tile.width = tile.height = px;
      drawFace(tile.getContext('2d'), p.face, px, { open: m.open, bright: m.bright, blink: st.blink > 0.5 ? 1 : st.blink * 2,
        energy: m.energy, color: p.color || look.color, glow: look.glow, alpha, time: t });
      ctx.drawImage(tile, spots[i].left, spots[i].top, spots[i].s, spots[i].s);
    });
  }
}
