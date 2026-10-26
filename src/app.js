import { drawFace } from './facepack.js';
import { LiveVoice } from './voice.js';
import { load, save } from './settings.js';
import { loadPacks, savePacks, parsePack, addPack, removePack, allFaces, findFace, builtIn, MAX_FILE_BYTES } from './packs.js';
import { placement, drag, scale, nudge } from './layout.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage'), ctx = canvas.getContext('2d');
const FACE_PX = 960;                              // the face is drawn square, then placed on the window
const face = document.createElement('canvas');
face.width = face.height = FACE_PX;
const fctx = face.getContext('2d');

const settings = load();
let packs = loadPacks();
const params = new URLSearchParams(location.search);
const say = (m) => { $('status').textContent = m; };
let toastTimer = 0;
function toast(m) {
  $('toast').textContent = m; $('toast').classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('on'), 1800);
}

// ---------------------------------------------------------------- settings
let saveTimer = 0;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(settings), 250); }
const sliders = ['size', 'x', 'y', 'glow', 'sens', 'gate'];
function syncControls() {
  for (const id of sliders) $(id).value = settings[id];
  $('color').value = settings.color;
}
for (const id of [...sliders, 'color']) {
  $(id).addEventListener('input', () => { settings[id] = id === 'color' ? $(id).value : +$(id).value; persist(); });
}
if (/^[0-9a-fA-F]{6}$/.test(params.get('color') || '')) settings.color = '#' + params.get('color');
syncControls();

// ---------------------------------------------------------------- faces and packs
let faces = allFaces(packs);
if (params.get('face')) settings.face = params.get('face');

function thumb(entry) {
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  drawFace(c.getContext('2d'), entry.face, 120, { open: 0.5, bright: 0.3, blink: 0, energy: 0.2, color: settings.color, glow: 0.5, alpha: 1, time: 1 });
  return c;
}

function renderFaces() {
  const root = $('facelist');
  root.replaceChildren();
  const cur = findFace(faces, settings.face);
  const packList = [builtIn(), ...packs];
  for (const p of packList) {
    const h = document.createElement('h2');
    h.append(document.createTextNode(p.name));
    if (p.id !== builtIn().id) {
      const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'danger', textContent: 'Remove' });
      rm.addEventListener('click', () => {
        packs = removePack(packs, p.id); savePacks(packs); faces = allFaces(packs); renderFaces(); toast('Removed ' + p.name);
      });
      h.append(rm);
    }
    const grid = Object.assign(document.createElement('div'), { className: 'grid' });
    for (const e of faces.filter((x) => x.pack.id === p.id)) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'face' });
      b.setAttribute('aria-pressed', String(e.key === cur.key));
      b.append(thumb(e), document.createTextNode(e.face.name));
      b.addEventListener('click', () => { settings.face = e.key; persist(); renderFaces(); });
      grid.append(b);
    }
    root.append(h, grid);
  }
}

$('packfile').addEventListener('change', async () => {
  const f = $('packfile').files[0];
  $('packfile').value = '';
  if (!f) return;
  try {
    if (f.size > MAX_FILE_BYTES) throw new Error('That file is too large');
    const pack = parsePack(await f.text());
    packs = addPack(packs, pack);
    if (!savePacks(packs)) toast('Added, but this browser would not keep it');
    faces = allFaces(packs);
    settings.face = `${pack.id}/${pack.faces[0].id}`; persist();
    renderFaces(); say(`Added ${pack.name} (${pack.faces.length} faces)`);
  } catch (e) { say(e.message || 'Could not add that pack'); }
});

if (params.get('pack')) {                           // ?pack=<url>: use a pack for this visit only
  fetch(params.get('pack')).then((r) => r.text()).then((t) => {
    const pack = parsePack(t);
    faces = allFaces([...packs.filter((p) => p.id !== pack.id), pack]);
    if (!params.get('face')) settings.face = `${pack.id}/${pack.faces[0].id}`;
    renderFaces();
  }).catch(() => say('Could not load that pack'));
}
renderFaces();

// ---------------------------------------------------------------- tabs
function showTab(name) {
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-pane]')) p.classList.toggle('on', p.dataset.pane === name);
}
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));

// ---------------------------------------------------------------- audio
let audio = null, voice = null, stream = null, el = null;
const audioUrl = globalThis.FACE_MIC_ONLY ? null : params.get('audio');
function ensureAudio() {
  if (!audio) { audio = new AudioContext(); voice = new LiveVoice(audio); }
  if (audio.state === 'suspended') audio.resume();
}
function stopSources() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (el) { el.pause(); el = null; }
  if (voice) try { voice.analyser.disconnect(); } catch { /* not connected */ }
}
function playUrl(url, label) {
  ensureAudio(); stopSources();
  el = new Audio(url);
  el.crossOrigin = 'anonymous';
  el.loop = params.get('loop') !== '0';
  const src = audio.createMediaElementSource(el);
  voice.connect(src);
  src.connect(audio.destination);
  return el.play().then(() => { say('Playing ' + label); return true; }, () => false);
}
async function useMic() {
  try {
    ensureAudio(); stopSources();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    voice.connect(audio.createMediaStreamSource(stream));
    say('Listening to the microphone');
  } catch (e) { say('Could not use the microphone: ' + (e.name || 'error')); throw e; }
}
$('mic').addEventListener('click', () => useMic().catch(() => {}));
$('file').addEventListener('change', () => {
  const f = $('file').files[0];
  if (!f) return;
  playUrl(URL.createObjectURL(f), f.name).then((ok) => { if (!ok) say('Press play again; the browser blocked autoplay'); });
});

// ---------------------------------------------------------------- menu and full screen
const nav = $('nav');
let mode = 'move';                                   // what the arrow keys do while the menu is hidden
const menuOpen = () => !nav.classList.contains('hidden');
function showMenu(on) { nav.classList.toggle('hidden', !on); if (on) $('play').focus(); }

async function start() {
  if (audioUrl) {
    if (!(await playUrl(audioUrl, 'the audio'))) { say('The audio could not be played'); return; }
  } else if (!stream && !el) {
    try { await useMic(); } catch { return; }        // the status line says why
  } else if (el) {
    await el.play().catch(() => {});
  }
  try { await document.documentElement.requestFullscreen(); } catch { /* not allowed here: just hide the menu */ }
  showMenu(false);
}
$('play').addEventListener('click', start);
$('fs').addEventListener('click', () => {
  showMenu(false);
  document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) showMenu(true); });
if (audioUrl) playUrl(audioUrl, 'the audio').then((ok) => { if (ok) showMenu(false); else say('Press Play to start the sound'); });

// ---------------------------------------------------------------- size and move
const pointers = new Map();
let moved = 0, pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = 0; pinch = 0;
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) Object.assign(settings, scale(settings, d / pinch));
    pinch = d;
  } else if (pointers.size === 1) {
    Object.assign(settings, drag(settings, dx, dy, innerWidth, innerHeight));
  }
  syncControls(); persist();
});
function endPointer(e) {
  pointers.delete(e.pointerId); pinch = 0;
  if (!pointers.size) {
    canvas.classList.remove('dragging');
    if (moved < 6 && e.type === 'pointerup') showMenu(!menuOpen());   // a tap shows or hides the menu
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  Object.assign(settings, scale(settings, Math.exp(-e.deltaY * 0.0015)));
  syncControls(); persist();
}, { passive: false });
$('reset').addEventListener('click', () => { Object.assign(settings, { x: 0, y: 0, size: 0.8 }); syncControls(); persist(); });

addEventListener('keydown', (e) => {
  if (menuOpen()) {
    if (e.key === 'Escape') showMenu(false);
    return;                                           // let the menu use its own keys
  }
  const step = e.shiftKey ? 0.05 : 0.02;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key]) {
    e.preventDefault();
    const [dx, dy] = arrows[e.key];
    if (mode === 'move') Object.assign(settings, nudge(settings, dx, dy));
    else if (dy) Object.assign(settings, scale(settings, dy < 0 ? 1.05 : 1 / 1.05));
    syncControls(); persist();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    mode = mode === 'move' ? 'size' : 'move';
    toast(mode === 'move' ? 'Arrows move the face' : 'Up and down resize the face');
  } else if (e.key === '+' || e.key === '=') { Object.assign(settings, scale(settings, 1.05)); syncControls(); persist(); }
  else if (e.key === '-') { Object.assign(settings, scale(settings, 1 / 1.05)); syncControls(); persist(); }
  else if (e.key === 'Escape' || e.key === 'ContextMenu' || e.key === 'Backspace' || e.key === 'm') showMenu(true);
});

// ---------------------------------------------------------------- drawing
function fit() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
let last = performance.now(), blinkAt = 2, blink = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;
  let m = { open: 0, bright: 0.5, energy: 0 };
  if (voice) { voice.sens = settings.sens; voice.gate = settings.gate; m = voice.update(dt); }
  if (t > blinkAt) { blink = 1; blinkAt = t + 2 + Math.random() * 4; }
  blink = Math.max(0, blink - dt * 7);
  drawFace(fctx, findFace(faces, settings.face).face, FACE_PX, { open: m.open, bright: m.bright, blink: blink > 0.5 ? 1 : blink * 2,
    energy: m.energy, color: settings.color, glow: settings.glow, alpha: 1, time: t });
  fit();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const p = placement(canvas.width, canvas.height, settings);
  ctx.drawImage(face, p.left, p.top, p.s, p.s);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
