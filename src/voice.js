// Turns an audio source into mouth values: open (0..1), bright (0..1, narrow vowels low), energy (0..1).
// Only the speech band is measured, so low rumble and cymbal hiss do not move the mouth.
import { Voice, bandDbFromLin, brightnessFromLin, clamp, DB_FLOOR } from './response.js';

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
    this.energy = 0;
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
    this.bright += (brightnessFromLin(this.lin, binHz) - this.bright) * clamp(dt * 12, 0, 1);
    this.energy += (open - this.energy) * clamp(dt * 6, 0, 1);
    return { open: this.voice.jaw, bright: clamp(this.bright * 2, 0, 1), energy: this.energy };
  }
}
