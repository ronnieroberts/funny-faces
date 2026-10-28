// Pure decisions behind the drawing speed: how big each face tile is, when a tile must be redrawn, and when to change
// quality. No browser needed, so all of it is unit tested.

/** Quality levels, best first. flameHz: how often flames are redrawn (the flicker is slow, so 24 looks the same as 60).
 *  tiles: largest tile by pumpkin count (1, 2, 3-4, 5+). detail: flame tongues kept (1 = all). glow: soft halo on or off. */
export const LEVELS = [
  { name: 'full', flameHz: 24, tiles: [1024, 768, 512, 384], detail: 1, glow: true },
  { name: 'medium', flameHz: 16, tiles: [768, 512, 384, 256], detail: 0.6, glow: true },
  { name: 'lite', flameHz: 10, tiles: [512, 384, 256, 192], detail: 0.35, glow: false },
];
export const QUALITY_SETTINGS = ['auto', 'full', 'lite'];

const STEPS = [128, 192, 256, 384, 512, 768, 1024];

/** Tile size in pixels for a pumpkin that is `px` pixels across: no bigger than needed, and never above `cap`.
 *  Fixed steps, so zooming does not reallocate on every frame. */
export function tileSize(px, cap = 1024) {
  const want = px * 0.9, fit = STEPS.find((s) => s >= want) || STEPS[STEPS.length - 1];
  return Math.min(fit, cap);
}

/** The largest tile allowed for `count` pumpkins at a level index. */
export function tileCap(count, level = 0) {
  const t = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))].tiles;
  return t[count <= 1 ? 0 : count === 2 ? 1 : count <= 4 ? 2 : 3];
}

/** Round to `steps` steps per unit, as an integer (so tiny changes in a mouth do not trigger a redraw). */
export const quant = (v, steps) => Math.round((v || 0) * steps);

/** Fill `key` (a reused array) with what a tile's picture depends on. Mouth values are rounded to steps nobody can see.
 *  Flames also depend on time, rounded to `hz` per second and shifted per pumpkin so they do not all redraw on one frame. */
export function tileKey(key, st, size, flame, hz, t, slot, color) {
  key[0] = quant(st.open, 64); key[1] = quant(st.bright, 64); key[2] = quant(st.blink, 16);
  key[3] = quant(st.energy, 32); key[4] = quant(st.alpha, 32); key[5] = size; key[6] = color;
  key[7] = flame ? Math.floor(t * hz + slot * 0.37) : 0;
  key[8] = quant(st.glow, 32); key[9] = st.level | 0;
  return key;
}

/** True when the picture must be redrawn: no earlier key, or any field differs. */
export function keyChanged(prev, key) {
  if (!prev) return true;
  for (let i = 0; i < key.length; i++) if (prev[i] !== key[i]) return true;
  return false;
}

/** Time to draw a flame tile with: the rounded step, so the picture is the same however often it is asked for. */
export const flameTime = (key7, hz, slot) => (key7 - slot * 0.37) / hz;

/**
 * Chooses the quality level from measured frame times (milliseconds between frames).
 * Steps down after the average stays above `slow` for `downAfter` ms; steps up only after it stays below `fast` for
 * `upAfter` ms, and each step up that is followed by a step down within `relapse` ms doubles the wait for the next
 * step up (so it settles instead of flipping back and forth). Frames longer than `ignore` ms (a hidden tab) are skipped.
 */
export class Governor {
  constructor({ slow = 28, fast = 19, downAfter = 2000, upAfter = 10000, relapse = 30000, ignore = 250, max = LEVELS.length - 1 } = {}) {
    Object.assign(this, { slow, fast, downAfter, upAfter, relapse, ignore, max });
    this.level = 0; this.avg = 0; this.since = 0; this.mode = ''; this.raisedAt = -Infinity; this.wait = upAfter; this.ready = false;
  }

  /** Feed one frame time at clock `now` (ms); returns the level to draw with. */
  update(frameMs, now) {
    if (!(frameMs > 0) || frameMs > this.ignore) { this.mode = ''; return this.level; }
    this.avg = this.ready ? this.avg + (frameMs - this.avg) * 0.1 : frameMs; this.ready = true;
    const mode = this.avg > this.slow && this.level < this.max ? 'down' : this.avg < this.fast && this.level > 0 ? 'up' : '';
    if (mode !== this.mode) { this.mode = mode; this.since = now; }
    if (mode === 'down' && now - this.since >= this.downAfter) {
      if (now - this.raisedAt < this.relapse) this.wait = Math.min(this.wait * 4, 600000);   // the last step up did not hold: wait longer
      this.level++; this.mode = ''; this.avg = (this.slow + this.fast) / 2;                    // measure again from scratch
    } else if (mode === 'up' && now - this.since >= this.wait) {
      this.level--; this.mode = ''; this.raisedAt = now; this.avg = (this.slow + this.fast) / 2;
    }
    return this.level;
  }
}
