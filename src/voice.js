// Turns an audio source into mouth values: open (0..1), bright (0..1, 0 = widest mouth), energy (0..1), and shape,
// one of the Rhubarb-style letters (see visemes.js). Loudness decides how far the jaw drops; the spectrum picks the shape.
// Only the speech band is measured, so low rumble and cymbal hiss do not move the mouth.
import { Voice, bandDbFromLin, clamp, DB_FLOOR } from './response.js';
import { VisemeTracker, shapeToMouth } from './visemes.js';
import { trackAt } from './track.js';

export const SPEECH = { lo: 150, hi: 3500 };

export class LiveVoice {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    this.bins = new Float32Array(this.analyser.frequencyBinCount);
    this.lin = new Float32Array(this.analyser.frequencyBinCount);
    this.voice = new Voice();
    this.tracker = new VisemeTracker();
    this.energy = 0;
    this.open = 0;
    this.bright = 0.5;
    this.gate = 0.35;       // how far above the quiet floor the mouth starts opening
    this.sens = 0;          // dB added to the input
  }

  connect(node) { node.connect(this.analyser); }

  /** Call once per animation frame with the elapsed seconds. */
  update(dt) {
    this.analyser.getFloatFrequencyData(this.bins);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    for (let i = 0; i < this.bins.length; i++) this.lin[i] = 10 ** (Math.max(this.bins[i], DB_FLOOR) / 10);
    const db = bandDbFromLin(this.lin, binHz, SPEECH.lo, SPEECH.hi);
    const open = this.voice.update(db, dt, this.gate, 0.5, this.sens);
    const shape = this.tracker.update(this.lin, binHz, open, dt);
    const m = shapeToMouth(shape, open), k = clamp(dt * 28, 0, 1);       // the mouth glides to each shape in about 40 ms
    this.open += (m.open - this.open) * k;
    this.bright += (m.bright - this.bright) * k;
    this.energy += (open - this.energy) * clamp(dt * 6, 0, 1);
    return { open: this.open, bright: this.bright, energy: this.energy, shape };
  }
}

/** Mouth from a pre-analysed track, following an audio element's clock. Same update() as LiveVoice. */
export class TrackVoice {
  constructor(track, getTime) {
    this.track = track; this.getTime = getTime;
    this.open = 0; this.bright = 0.5; this.energy = 0;
    this.gate = 0.35; this.sens = 0;                    // unused: the track was analysed once, up front
  }
  update(dt) {
    const { letter, loud } = trackAt(this.track, this.getTime());
    const m = shapeToMouth(letter, loud), k = clamp(dt * 28, 0, 1);
    this.open += (m.open - this.open) * k;
    this.bright += (m.bright - this.bright) * k;
    this.energy += (loud - this.energy) * clamp(dt * 6, 0, 1);
    return { open: this.open, bright: this.bright, energy: this.energy, shape: letter };
  }
}
