import { drawFace } from './facepack.js';
import { LiveVoice, TrackVoice } from './voice.js';
import { analyze } from './track.js';
import { load, save } from './settings.js';
import { loadPacks, savePacks, parsePack, addPack, removePack, allFaces, findFace, builtIn, MAX_FILE_BYTES } from './packs.js';
import { placement, drag, scale, nudge } from './layout.js';
import { Link, loadConfig } from './relay.js';
import { buildState, parseState, packMouth, unpackMouth, isNewer, changed } from './share.js';

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
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(settings), 250); scheduleShare(); }
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

// ---------------------------------------------------------------- screens: show the face on other displays
const screenMode = params.has('screen');                // this page is a display, not the main screen
if (screenMode) document.body.classList.add('screen');
const mem = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
const ADMIN_KEY = 'face-characters.admin.v1', SCREEN_KEY = 'face-characters.screen.v1';
let relayUrl = null, link = null;

// main screen side
let admin = mem.get(ADMIN_KEY);                         // {session, key} once a screen has been paired
let ready = false, screensN = 0, seq = 0, pendingCode = '', shareTimer = 0, sentMouth = null, lastSend = 0;
const epoch = Math.floor(Math.random() * 2 ** 30);
const sayScreens = (m) => { $('screenstatus').textContent = m; };
function screensText() {
  return screensN > 0 ? `${screensN} screen${screensN === 1 ? '' : 's'} showing the face` : (admin ? 'Paired. Waiting for a screen to connect.' : 'No screens yet.');
}
function pushState() {
  if (!ready || screenMode) return;
  link.send({ action: 'state', state: buildState(settings, findFace(faces, settings.face).face, epoch), n: ++seq });
}
function scheduleShare() { clearTimeout(shareTimer); shareTimer = setTimeout(pushState, 150); }

function startAdminLink() {
  if (!relayUrl || link) return;
  link = new Link(relayUrl, {
    open() {
      if (pendingCode) link.send({ action: 'pair', code: pendingCode, session: admin && admin.session, key: admin && admin.key });
      else if (admin) link.send({ action: 'admin', session: admin.session, key: admin.key });
    },
    message(m) {
      if (m.type === 'paired' && typeof m.session === 'string' && typeof m.key === 'string') {
        admin = { session: m.session, key: m.key }; mem.set(ADMIN_KEY, admin);
        pendingCode = ''; ready = true; screensN = Number(m.screens) || 0; sentMouth = null;
        pushState(); sayScreens(screensText());
      } else if (m.type === 'ready') {
        ready = true; screensN = Number(m.screens) || 0; sentMouth = null; pushState(); sayScreens(screensText());
      } else if (m.type === 'screens') {
        if (m.n > 0 && screensN === 0) sentMouth = null;
        screensN = Number(m.n) || 0; sayScreens(screensText());
      } else if (m.type === 'error') {
        pendingCode = '';
        if (m.error === 'unknown_session') { admin = null; mem.del(ADMIN_KEY); ready = false; sayScreens('Sharing was reset. Add the screen again.'); }
        else if (m.error === 'too_many_attempts') sayScreens('Too many wrong codes. Reload this page and try again.');
        else sayScreens('That code was not recognised. Check the screen and try again.');
      }
    },
    close() { ready = false; },
  });
  link.start();
}

function pairWith(code) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');   // the TV shows "ABC DEF"; spaces and dashes are fine
  if (c.length !== 6) { sayScreens('The code has 6 letters and numbers.'); return; }
  pendingCode = c; sayScreens('Connecting…');
  if (!link) startAdminLink();
  else if (link.open) link.send({ action: 'pair', code: c, session: admin && admin.session, key: admin && admin.key });
}
$('pairbtn').addEventListener('click', () => { pairWith($('pairinput').value); $('pairinput').value = ''; });
$('pairinput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pairbtn').click(); });
$('endshare').addEventListener('click', () => {
  if (link && link.open && admin) link.send({ action: 'end' });
  if (link) { link.stop(); link = null; }
  admin = null; mem.del(ADMIN_KEY); ready = false; screensN = 0; pendingCode = '';
  sayScreens('Stopped sharing.');
});

// display side
let display = null, curEpoch = -1, lastState = -1, lastMouthN = -1;
const target = { open: 0, bright: 0.5, energy: 0 }, shown = { open: 0, bright: 0.5, energy: 0 };
function showPairBox(code, msg) {
  $('pairbox').hidden = false;
  $('paircode').textContent = code ? code.slice(0, 3) + ' ' + code.slice(3) : '';
  $('pairmsg').textContent = msg;
}

function startDisplayLink() {
  let again = 0;
  link = new Link(relayUrl, {
    open() {
      const s = mem.get(SCREEN_KEY);
      link.send(s ? { action: 'screen', session: s.session } : { action: 'register' });
    },
    message(m) {
      if (m.type === 'code' && typeof m.code === 'string') {
        showPairBox(m.code, 'On the main screen open the Screens tab and type this code.');
        clearTimeout(again);
        again = setTimeout(() => { if (!mem.get(SCREEN_KEY)) link.send({ action: 'register' }); }, Math.max(30, (m.expires || 600) - 30) * 1000);
      } else if (m.type === 'paired') {
        mem.set(SCREEN_KEY, { session: m.session });
        clearTimeout(again);
        if (display) $('pairbox').hidden = true; else showPairBox('', 'Connected. Waiting for the main screen…');
      } else if (m.type === 'state') {
        const st = parseState(m.state);
        if (!st) return;
        if (st.epoch !== curEpoch) { curEpoch = st.epoch; lastState = -1; lastMouthN = -1; }
        if (!isNewer(m.n, lastState)) return;
        if (Number.isInteger(m.n)) lastState = m.n;
        display = st; $('pairbox').hidden = true;
      } else if (m.type === 'm') {
        const v = unpackMouth(m.v);
        if (!v || !isNewer(m.n, lastMouthN)) return;
        if (Number.isInteger(m.n)) lastMouthN = m.n;
        Object.assign(target, v);
      } else if (m.type === 'ended' || (m.type === 'error' && m.error === 'unknown_session')) {
        mem.del(SCREEN_KEY); display = null; link.send({ action: 'register' });
      }
    },
    close() { if (!display) showPairBox('', 'Connecting…'); },
  });
  link.start();
}

async function initRelay() {
  const cfg = await loadConfig();
  relayUrl = cfg && cfg.relay;
  if (cfg && cfg.info && cfg.info.urls.length) {
    $('tvurl').textContent = cfg.info.urls[0] + '/screen';
    $('tvurlrow').hidden = false;
  }
  if (screenMode) {
    if (!relayUrl) showPairBox('', 'This page needs to be opened from Funny Faces on your computer.');
    else { showPairBox('', 'Connecting…'); startDisplayLink(); }
    return;
  }
  if (!relayUrl) { $('screenpane').hidden = true; $('noscreens').hidden = false; return; }
  sayScreens(screensText());
  if (admin) startAdminLink();
}
initRelay();

// ---------------------------------------------------------------- tabs
function showTab(name) {
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-pane]')) p.classList.toggle('on', p.dataset.pane === name);
}
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));

// ---------------------------------------------------------------- audio
let audio = null, voice = null, live = null, stream = null, el = null;
const audioUrl = globalThis.FACE_MIC_ONLY ? null : params.get('audio');
function ensureAudio() {
  if (!audio) { audio = new AudioContext(); live = voice = new LiveVoice(audio); }
  if (audio.state === 'suspended') audio.resume();
}
function stopSources() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (el) { el.pause(); el = null; }
  if (live) { try { live.analyser.disconnect(); } catch { /* not connected */ } voice = live; }
}
// A file or link is analysed once, in this browser, into a mouth track; if that fails the sound is analysed live instead.
const trackCache = new Map();                              // url and option -> track, so pressing Play again does not re-analyse
async function playTrack(url, label, bytes) {
  ensureAudio();
  try {
    const key = url + '|' + $('centre').checked;
    let track = trackCache.get(key);
    if (!track) {
    say('Analysing ' + label + '…');
    const buf = await audio.decodeAudioData(bytes ? await bytes() : await (await fetch(url)).arrayBuffer());
    const mid = new Float32Array(buf.length), side = buf.numberOfChannels > 1 ? new Float32Array(buf.length) : null;
    const a = buf.getChannelData(0), b = side ? buf.getChannelData(1) : null;
    for (let i = 0; i < mid.length; i++) { mid[i] = b ? (a[i] + b[i]) / 2 : a[i]; if (side) side[i] = (a[i] - b[i]) / 2; }
    track = await analyze({ mid, side, sampleRate: buf.sampleRate }, { centre: $('centre').checked, gate: settings.gate,
      onProgress: (p) => say(`Analysing ${label}… ${Math.round(p * 100)}%`) });
    trackCache.set(key, track);
    }
    stopSources();
    el = new Audio(url);
    el.crossOrigin = 'anonymous';
    el.loop = params.get('loop') !== '0';
    voice = new TrackVoice(track, () => (el ? el.currentTime : 0));
    await el.play();
    say('Playing ' + label + ' with a mouth track (' + Math.round(track.data.length / 2 / track.fps) + ' s analysed)');
    return true;
  } catch { return playUrl(url, label); }
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
  playTrack(URL.createObjectURL(f), f.name, () => f.arrayBuffer()).then((ok) => { if (!ok) say('Press play again; the browser blocked autoplay'); });
});

// ---------------------------------------------------------------- menu and full screen
const nav = $('nav');
let mode = 'move';                                   // what the arrow keys do while the menu is hidden
const menuOpen = () => !nav.classList.contains('hidden');
function showMenu(on) { nav.classList.toggle('hidden', !on); if (on) $('play').focus(); }

async function start() {
  if (audioUrl) {
    if (!(await playTrack(audioUrl, 'the audio'))) { say('The audio could not be played'); return; }
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
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !screenMode) showMenu(true); });
if (audioUrl && !screenMode) playTrack(audioUrl, 'the audio').then((ok) => { if (ok) showMenu(false); else say('Press Play to start the sound'); });

// ---------------------------------------------------------------- size and move
const pointers = new Map();
let moved = 0, pinch = 0;
const goFull = () => document.documentElement.requestFullscreen().catch(() => {});
canvas.addEventListener('pointerdown', (e) => {
  if (screenMode) { goFull(); return; }              // a display only needs a tap to go full screen
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
  if (screenMode) return;
  e.preventDefault();
  Object.assign(settings, scale(settings, Math.exp(-e.deltaY * 0.0015)));
  syncControls(); persist();
}, { passive: false });
$('reset').addEventListener('click', () => { Object.assign(settings, { x: 0, y: 0, size: 0.8 }); syncControls(); persist(); });

addEventListener('keydown', (e) => {
  if (screenMode) { if (e.key === 'Enter') goFull(); return; }
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

// The voice is measured and sent from a timer, not from the drawing loop: a browser stops the drawing loop in a
// hidden tab, which would stop the other screens' mouths. A worker's timer is not slowed down in the background.
let lastMouth = { open: 0, bright: 0.5, energy: 0 }, tickAt = performance.now();
function tick() {
  if (screenMode || !voice) return;
  const now = performance.now(), dt = Math.min(0.1, (now - tickAt) / 1000);
  tickAt = now;
  voice.sens = settings.sens; voice.gate = settings.gate;
  lastMouth = voice.update(dt);
  if (ready && screensN > 0 && now - lastSend >= 66) {
    const v = packMouth(lastMouth);
    if (changed(sentMouth, v)) { link.send({ action: 'm', v, n: ++seq }); sentMouth = v; lastSend = now; }
  }
}
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })));
  w.onmessage = tick;
} catch { setInterval(tick, 33); }

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;
  let m = { open: 0, bright: 0.5, energy: 0 };
  if (screenMode) {                                   // follow what the main screen sent, smoothed between updates
    const k = Math.min(1, dt * 18);
    for (const key of ['open', 'bright', 'energy']) shown[key] += (target[key] - shown[key]) * k;
    m = shown;
  } else if (voice) {
    m = lastMouth;                                     // measured by the timer below, which keeps running in a hidden tab
  }
  if (t > blinkAt) { blink = 1; blinkAt = t + 2 + Math.random() * 4; }
  blink = Math.max(0, blink - dt * 7);
  const look = screenMode ? display : settings;
  const faceObj = screenMode ? (display && display.face) : findFace(faces, settings.face).face;
  if (faceObj) {
    drawFace(fctx, faceObj, FACE_PX, { open: m.open, bright: m.bright, blink: blink > 0.5 ? 1 : blink * 2,
      energy: m.energy, color: look.color, glow: look.glow, alpha: 1, time: t });
  }
  fit();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (faceObj) {
    const p = placement(canvas.width, canvas.height, look);
    ctx.drawImage(face, p.left, p.top, p.s, p.s);
  }
requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
