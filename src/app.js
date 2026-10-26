import { STARTER_PACK, drawFace, validatePack } from './facepack.js';
import { LiveVoice } from './voice.js';
import { load, save } from './settings.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage'), ctx2d = canvas.getContext('2d');
const S = 720;
canvas.width = canvas.height = S;
const settings = load();
const faces = validatePack(STARTER_PACK).faces;

for (const f of faces) $('face').append(new Option(f.name, f.id));
$('face').value = faces.some((f) => f.id === settings.face) ? settings.face : faces[0].id;
$('color').value = settings.color;
$('glow').value = settings.glow;
$('sens').value = settings.sens;
$('gate').value = settings.gate;

let audio = null, voice = null, stream = null, el = null;
function ensureAudio() {
  if (!audio) { audio = new AudioContext(); voice = new LiveVoice(audio); }
  if (audio.state === 'suspended') audio.resume();
}
function stopSources() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (el) { el.pause(); el = null; }
  if (voice) try { voice.analyser.disconnect(); } catch { /* not connected */ }
}
const say = (m) => { $('status').textContent = m; };

$('mic').addEventListener('click', async () => {
  try {
    ensureAudio(); stopSources();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    voice.connect(audio.createMediaStreamSource(stream));
    say('Listening to the microphone');
  } catch (e) { say('Could not use the microphone: ' + (e.name || 'error')); }
});

$('file').addEventListener('change', () => {
  const f = $('file').files[0];
  if (!f) return;
  ensureAudio(); stopSources();
  el = new Audio(URL.createObjectURL(f));
  el.crossOrigin = 'anonymous';
  const src = audio.createMediaElementSource(el);
  voice.connect(src);
  src.connect(audio.destination);
  el.play().then(() => say('Playing ' + f.name), () => say('Press play again; the browser blocked autoplay'));
});

$('fs').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
addEventListener('keydown', (e) => { if (e.key === 'h') $('panel').classList.toggle('hidden'); });

function persist() {
  Object.assign(settings, { face: $('face').value, color: $('color').value, glow: +$('glow').value, sens: +$('sens').value, gate: +$('gate').value });
  save(settings);
}
for (const id of ['face', 'color', 'glow', 'sens', 'gate']) $(id).addEventListener('input', persist);

let last = performance.now(), blinkAt = 2, blink = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;
  let m = { open: 0, bright: 0.5, energy: 0 };
  if (voice) { voice.sens = settings.sens; voice.gate = settings.gate; m = voice.update(dt); }
  if (t > blinkAt) { blink = 1; blinkAt = t + 2 + Math.random() * 4; }
  blink = Math.max(0, blink - dt * 7);
  const face = faces.find((f) => f.id === settings.face) || faces[0];
  drawFace(ctx2d, face, S, { open: m.open, bright: m.bright, blink: blink > 0.5 ? 1 : blink * 2, energy: m.energy,
    color: settings.color, glow: settings.glow, alpha: 1, time: t });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
