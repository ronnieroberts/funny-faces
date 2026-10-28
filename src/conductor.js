// Decides which pumpkins talk when they all hear the same sound.
//   sync    every pumpkin moves together
//   turns   one pumpkin speaks per phrase and the next phrase goes to the next pumpkin
//   random  after each silence a random pumpkin starts, and the others may break in for a moment
// (bands mode needs no conductor: each pumpkin listens to its own voice range.)
export class Conductor {
  constructor(rand = Math.random) {
    this.rand = rand; this.leader = -1; this.inPhrase = false; this.lastActive = -99; this.breaks = [];
  }

  /** t in seconds; level 0..1 is the loudness; returns one weight (0 or 1) per pumpkin. */
  update(t, level, n, { mode, turnPause, breakIns }) {
    if (mode === 'sync' || mode === 'bands' || n < 2) return new Array(n).fill(1);
    if (level > 0.05) {
      if (!this.inPhrase) {
        if (t - this.lastActive > turnPause || this.leader < 0) {
          const prev = this.leader;
          this.leader = mode === 'turns' ? (prev + 1) % n : this._other(prev, n);
          this.breaks = [];
        }
        this.inPhrase = true;
      }
      this.lastActive = t;
    } else if (this.inPhrase && t - this.lastActive > turnPause) this.inPhrase = false;
    if (this.leader >= n) this.leader = 0;

    return Array.from({ length: n }, (_, i) => {
      if (i === this.leader) return 1;
      if (mode !== 'random' || !this.inPhrase) return 0;
      const b = this.breaks[i] || (this.breaks[i] = { until: -1, next: t + 0.6 + this.rand() * 2 });
      if (t >= b.next && t >= b.until) {
        if (this.rand() < breakIns) b.until = t + 0.4 + this.rand();
        b.next = Math.max(t, b.until) + 0.8 + this.rand() * 3;
      }
      return t < b.until ? 1 : 0;
    });
  }

  _other(prev, n) {
    if (prev < 0) return Math.floor(this.rand() * n);
    const k = Math.floor(this.rand() * (n - 1));
    return k >= prev ? k + 1 : k;                         // any pumpkin but the last speaker
  }
}
