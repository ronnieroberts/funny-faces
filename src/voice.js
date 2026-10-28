// Turns a sound source into one mouth per pumpkin.
//   LiveSource   a microphone or an audio element: gives the spectrum every frame
//   TrackSource  a song analysed in advance (track.js): gives a mouth letter and a loudness every frame
//   Mouths       decides, for every pumpkin, how far its mouth is open and which shape it makes
// Each mouth is {open, bright, energy, shape}: open 0..1, bright 0 = widest mouth, energy 0..1 for eyebrows and flames.
import { Voice, VOICE_RANGES, bandDbFromLin, clamp, DB_FLOOR } from './response.js';
import { VisemeTracker, shapeToMouth } from './visemes.js';
import { Conductor } from './conductor.js';
import { trackAt } from './track.js';

export const SPEECH = { lo: 150, hi: 3500 };
const BASS = { lo: 40, hi: 160 };                     // kick drums and bass guitar live here

export class LiveSource {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    this.bins = new Float32Array(this.analyser.frequencyBinCount);
    this.lin = new Float32Array(this.analyser.frequencyBinCount);
  }

  connect(node) { node.connect(this.analyser); }

  /** The spectrum right now: {lin (linear power per bin), binHz}. */
  frame() {
    this.analyser.getFloatFrequencyData(this.bins);
    for (let i = 0; i < this.bins.length; i++) this.lin[i] = 10 ** (Math.max(this.bins[i], DB_FLOOR) / 10);
    return { lin: this.lin, binHz: this.ctx.sampleRate / this.analyser.fftSize };
  }
}

export class TrackSource {
  constructor(track, getTime) { this.track = track; this.getTime = getTime; }
  frame() { return trackAt(this.track, this.getTime()); }       // {letter, loud}
}

export class Mouths {
  constructor() {
    this.full = new Voice(); this.tracker = new VisemeTracker(); this.conductor = new Conductor();
    this.bands = new Map(); this.out = [];
  }

  /** frame from a source; s = settings (mode, turnPause, breakIns, adv); pumpkins = the enabled ones; t, dt in seconds. */
  update(frame, dt, t, s, pumpkins) {
    const a = s.adv, n = pumpkins.length, live = !!frame.lin;
    let loud, letter;
    if (live) {
      let db = bandDbFromLin(frame.lin, frame.binHz, SPEECH.lo, SPEECH.hi) + a.inputDb;
      if (a.voiceFocus > 0) {                          // drums and bass guitar move the mouth less
        const low = bandDbFromLin(frame.lin, frame.binHz, BASS.lo, BASS.hi) + a.inputDb;
        db -= a.voiceFocus * 12 * clamp((low - db) / 10, 0, 1);
      }
      this.full.update(db, dt, a.gate, a.snap, 0);
      loud = this.full.jaw;
      letter = this.tracker.update(frame.lin, frame.binHz, loud, dt);
    } else { loud = frame.loud; letter = frame.letter; }

    const mode = s.mode === 'bands' && !live ? 'sync' : s.mode;     // a prepared song has no separate voice ranges
    const weights = this.conductor.update(t, loud, n, { mode, turnPause: s.turnPause, breakIns: s.breakIns });
    const k = clamp(dt * (10 + 45 * a.snap), 0, 1);                   // how fast the mouth glides to its next shape
    const out = [];
    pumpkins.forEach((p, i) => {
      let drive;
      if (mode === 'bands') {
        let v = this.bands.get(i);
        if (!v) this.bands.set(i, v = new Voice());
        const r = VOICE_RANGES[p.voice] || VOICE_RANGES.full;
        v.update(bandDbFromLin(frame.lin, frame.binHz, r.lo, r.hi) + a.inputDb + p.trim, dt, a.gate, a.snap, 0);
        drive = v.jaw;
      } else drive = weights[i] * clamp(loud * 10 ** (p.trim / 20), 0, 1);
      drive = clamp(drive, 0, 1);
      // a pumpkin hearing only its own voice range may be sounding while the whole mix reads as rest: use an open mouth then
      const shape = drive < 0.06 ? 'X' : letter === 'X' || letter === 'A' ? 'C' : letter;
      const m = shapeToMouth(shape, drive);
      const plain = { open: drive, bright: 0.5 };
      const goal = { open: clamp((plain.open + (m.open - plain.open) * a.shapeDetail) * a.outputGain, 0, 1),     // output sensitivity: how wide it opens
        bright: plain.bright + (m.bright - plain.bright) * a.shapeDetail };
      const o = this.out[i] || (this.out[i] = { open: 0, bright: 0.5, energy: 0, shape: 'X' });
      o.open += (goal.open - o.open) * k;
      o.bright += (goal.bright - o.bright) * k;
      o.energy += (clamp(drive * a.outputGain, 0, 1) - o.energy) * clamp(dt * 6, 0, 1);
      o.shape = shape;
      out.push({ ...o });
    });
    return out;
  }
}
