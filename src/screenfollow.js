// What a display screen shows of the mouths, as a small pure state machine: no timers, no network, no drawing.
// The screen is a function of the latest mouth frame and of whether the control page is there; time is passed in.
import { isNewer16 } from './share.js';

export const SILENCE_MS = 1500;   // the control page resends a held mouth every 400 ms, so this long with nothing means it is gone
const RATE = 18;                  // how fast the mouths ease toward their target, per second

const live = (m) => m.open > 0 || m.energy > 0;

export function createFollow({ silenceMs = SILENCE_MS } = {}) {
  let target = [], shown = [], lastN = -1, lastAt = 0, gone = false;
  const closed = (m) => ({ open: 0, bright: m.bright, energy: 0 });
  return {
    /** A different control page session started: forget the old sequence numbers. */
    reset() { lastN = -1; },
    /** A mouth frame arrived ({n, mouths} from parseMouth). Returns false when it was old and ignored. */
    apply(frame, now) {
      if (!frame || !isNewer16(frame.n, lastN)) return false;
      lastN = frame.n; lastAt = now; gone = false; target = frame.mouths;
      return true;
    },
    /** The control page disconnected: ease closed and stay closed until a frame arrives or it is back. */
    adminGone() { gone = true; target = target.map(closed); },
    adminBack() { gone = false; },
    /** Move the shown mouths toward what they should be now; dt in seconds, now in ms. Returns the mouths to draw. */
    tick(dt, now) {
      const silent = !gone && now - lastAt > silenceMs && target.some(live);
      if (silent) target = target.map(closed);
      const k = Math.min(1, dt * RATE);
      shown = target.map((m, i) => {
        const s = shown[i] || m;
        return { open: s.open + (m.open - s.open) * k, bright: s.bright + (m.bright - s.bright) * k, energy: s.energy + (m.energy - s.energy) * k };
      });
      return shown;
    },
  };
}
