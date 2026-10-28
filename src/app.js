import { drawFace } from './facepack.js';
import { LiveSource, TrackSource, Mouths } from './voice.js';
import { analyze } from './track.js';
import { qrSvg } from './qr.js';
import { load, save, resize, arrange, ADV_DEFAULTS, MAX_PUMPKINS, VOICE_NAMES } from './settings.js';
import { Stage } from './stage.js';
import { runBench } from './bench.js';
import { loadPacks, savePacks, parsePack, addPack, removePack, allFaces, findFace, builtIn, MAX_FILE_BYTES, mergePacks, loadFolderPacks, describeProblems } from './packs.js';
import { drag, scale, nudge } from './layout.js';
import { moveAll, scaleAll, resetSkew, viewDelta } from './quad.js';
import { createEditor } from './editor.js';
import { Link, loadConfig } from './relay.js';
import { buildState, parseState, packMouth, mouthFrame, parseMouth, isNewer, changed } from './share.js';
import { createFollow } from './screenfollow.js';
import { captureTabAudio, tabAudioSupported, TAB_AUDIO_MESSAGES } from './tabaudio.js';
import { applyOutput, loadScreenOutput, saveScreenOutput, screenAddress, createWakeLock, awakeMessage } from './output.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const stage = new Stage(canvas);                       // takes the canvas's context: WebGL2, or 2D when that is missing
const aspect = () => innerWidth / innerHeight;                  // the stage fills the window (see Stage.fit)

const settings = load(undefined, innerWidth / innerHeight);
$('renderinfo').textContent = stage.mode === 'webgl2' ? 'Drawing with WebGL2: pumpkins can be skewed in perspective.'
  : 'This browser has no WebGL2. Faces are drawn flat: they move, zoom and rotate, but skew has no perspective.';
let packs = loadPacks();
const params = new URLSearchParams(location.search);
const say = (m) => { $('status').textContent = m; };
if (stage.mode !== 'webgl2') say('No WebGL2 in this browser: faces are drawn flat, without perspective warp.');
let toastTimer = 0;
function toast(m) {
  $('toast').textContent = m; $('toast').classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('on'), 1800);
}

// ---------------------------------------------------------------- settings
let saveTimer = 0, sel = 0;                                   // sel: the pumpkin the Faces and Layout tabs are editing
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(settings), 250); scheduleShare(); }
const pathOf = (el) => el.dataset.path.replace(/^pk\./, `pumpkins.${sel}.`);
const getPath = (path) => path.split('.').reduce((a, k) => a[k], settings);
function setPath(path, v) { const ks = path.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], settings)[last] = v; }
const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : '');
function syncControls() {
  for (const el of document.querySelectorAll('[data-path]')) {
    const v = getPath(pathOf(el));
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  for (const o of document.querySelectorAll('output[data-for]')) o.textContent = fmt(getPath(pathOf({ dataset: { path: o.dataset.for } })));
  for (const k of ['size', 'x', 'y']) $(k).value = settings[k];
  document.body.dataset.mode = settings.mode;
}
for (const el of document.querySelectorAll('[data-path]')) {
  el.addEventListener('input', () => {
    setPath(pathOf(el), el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value);
    syncControls(); persist();
  });
}
if (/^[0-9a-fA-F]{6}$/.test(params.get('color') || '')) settings.color = '#' + params.get('color');
$('reset-adv').addEventListener('click', () => { Object.assign(settings.adv, ADV_DEFAULTS); syncControls(); persist(); toast('Advanced settings reset'); });
syncControls();

// ---------------------------------------------------------------- faces and packs
let folderPacks = [];                               // from the packs folder: re-read on every load, never removable here
const shownPacks = () => mergePacks(packs, folderPacks);
let faces = allFaces(shownPacks());
if (params.get('face')) settings.pumpkins[0].face = params.get('face');

function thumb(entry) {
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  drawFace(c.getContext('2d'), entry.face, 120, { open: 0.5, bright: 0.3, blink: 0, energy: 0.2, color: settings.color, glow: 0.5, alpha: 1, time: 1 });
  return c;
}

function renderFaces() {
  const root = $('facelist');
  root.replaceChildren();
  const cur = findFace(faces, settings.pumpkins[sel].face);
  const packList = [builtIn(), ...shownPacks()];
  for (const p of packList) {
    const h = document.createElement('h2');
    h.append(document.createTextNode(p.name));
    if (folderPacks.includes(p)) h.append(Object.assign(document.createElement('small'), { textContent: ' from the packs folder' }));
    else if (p.id !== builtIn().id) {
      const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'danger', textContent: 'Remove' });
      rm.addEventListener('click', () => {
        packs = removePack(packs, p.id); savePacks(packs); faces = allFaces(shownPacks()); renderFaces(); toast('Removed ' + p.name);
      });
      h.append(rm);
    }
    const grid = Object.assign(document.createElement('div'), { className: 'grid' });
    for (const e of faces.filter((x) => x.pack.id === p.id)) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'face' });
      b.setAttribute('aria-pressed', String(e.key === cur.key));
      b.append(thumb(e), document.createTextNode(e.face.name));
      b.addEventListener('click', () => { settings.pumpkins[sel].face = e.key; persist(); renderFaces(); renderPumpkins(); });
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
    packs = addPack(packs, pack, folderPacks);
    if (!savePacks(packs)) toast('Added, but this browser would not keep it');
    faces = allFaces(shownPacks());
    settings.pumpkins[sel].face = `${pack.id}/${pack.faces[0].id}`; persist();
    renderFaces(); renderPumpkins(); say(`Added ${pack.name} (${pack.faces.length} faces)`);
  } catch (e) { say(e.message || 'Could not add that pack'); }
});

loadFolderPacks().then(({ packs: found, problems }) => {      // the packs folder on the server, offered next to the built-in faces
  if (problems.length) $('packnotice').textContent = 'Some files in the packs folder were skipped:\n' + describeProblems(problems).join('\n');
  if (!found.length) return;
  folderPacks = found; faces = allFaces(shownPacks()); renderFaces(); renderPumpkins();
});
renderFaces();

// ---------------------------------------------------------------- pumpkins: how many, which voice each listens to
function renderPumpkins() {
  $('count').value = String(settings.pumpkins.length);
  sel = Math.min(sel, settings.pumpkins.length - 1);
  const root = $('pumpkinlist');
  root.replaceChildren();
  settings.pumpkins.forEach((p, i) => {
    const row = Object.assign(document.createElement('div'), { className: 'prow' });
    const pick = Object.assign(document.createElement('button'), { type: 'button', className: 'pick', textContent: `${i + 1}. ${findFace(faces, p.face).face.name}` });
    pick.setAttribute('aria-pressed', String(i === sel));
    pick.title = 'Edit this pumpkin on the Faces and Layout tabs';
    pick.addEventListener('click', () => { sel = i; syncControls(); renderFaces(); renderPumpkins(); });
    const on = Object.assign(document.createElement('input'), { type: 'checkbox', checked: p.enabled, title: 'Show this pumpkin' });
    on.addEventListener('change', () => { p.enabled = on.checked; persist(); });
    const voice = document.createElement('select');
    voice.className = 'voice'; voice.title = 'Which voices this pumpkin listens to (Voice bands mode)';
    for (const [k, name] of Object.entries(VOICE_NAMES)) voice.append(Object.assign(document.createElement('option'), { value: k, textContent: name, selected: k === p.voice }));
    voice.addEventListener('change', () => { p.voice = voice.value; persist(); });
    const trim = Object.assign(document.createElement('input'), { type: 'range', min: -20, max: 20, step: 1, value: p.trim, title: 'Level: make this pumpkin more or less sensitive' });
    trim.className = 'trim'; trim.addEventListener('input', () => { p.trim = +trim.value; persist(); });
    row.append(on, pick, voice, trim);
    root.append(row);
  });
}
$('count').addEventListener('change', () => {
  settings.pumpkins = resize(settings.pumpkins, +$('count').value, aspect(), settings);
  renderPumpkins(); renderFaces(); persist();
});
for (let n = 1; n <= MAX_PUMPKINS; n++) $('count').append(Object.assign(document.createElement('option'), { value: n, textContent: n === 1 ? '1 pumpkin' : `${n} pumpkins` }));
renderPumpkins();
$('arrange').addEventListener('click', () => {
  settings.pumpkins = arrange(settings.pumpkins, aspect(), settings);
  syncControls(); persist(); toast('Pumpkins re-arranged');
});
$('resetskew').addEventListener('click', () => {
  const p = settings.pumpkins[sel];
  p.quad = resetSkew(p.quad, aspect());
  persist(); toast('Skew reset');
});

// ---------------------------------------------------------------- screens: show the face on other displays
const screenMode = params.has('screen');                // this page is a display, not the main screen
if (screenMode) document.body.classList.add('screen');

// ---- output: mirror, flip and keep-awake belong to this device (a screen keeps its own, from ?mirror=1&flip=1&awake=0)
const output = screenMode ? loadScreenOutput(params) : settings.output;
applyOutput(output, document.body);
const wake = createWakeLock(navigator, document);
let playingNow = false;
function refreshAwake() { return playingNow && output.keepAwake ? wake.acquire() : wake.release(); }
wake.onchange = (s) => {
  const m = awakeMessage(s);
  $('awakestatus').textContent = m || '';
  if (m && screenMode) toast(m);
};
function setPlaying(on) { playingNow = on; refreshAwake(); }
for (const el of document.querySelectorAll('[data-path^="output."]')) {
  el.addEventListener('input', () => { applyOutput(output, document.body); refreshAwake(); });
}
function screenKey(e) {                                  // on a display: M mirrors, F flips
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey || e.altKey || (k !== 'm' && k !== 'f')) return false;
  const name = k === 'm' ? 'mirror' : 'flip';
  output[name] = !output[name];
  applyOutput(output, document.body); saveScreenOutput(output);
  toast(`${name === 'mirror' ? 'Mirror' : 'Flip'} ${output[name] ? 'on' : 'off'}`);
  return true;
}
addEventListener('pagehide', () => { wake.release(); });
const mem = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
const ADMIN_KEY = 'face-characters.admin.v1', SCREEN_KEY = 'face-characters.screen.v1';
let relayUrl = null, link = null;

// main screen side
let admin = mem.get(ADMIN_KEY);                         // {session, key} once a screen has been paired
let ready = false, screensN = 0, seq = 0, mouthSeq = 0, pendingCode = '', shareTimer = 0, sentMouth = null, lastSend = 0;
const epoch = Math.floor(Math.random() * 2 ** 30);
const sayScreens = (m) => { $('screenstatus').textContent = m; };
function screensText() {
  return screensN > 0 ? `${screensN} screen${screensN === 1 ? '' : 's'} showing the face` : (admin ? 'Paired. Waiting for a screen to connect.' : 'No screens yet.');
}
function pushState() {
  if (!ready || screenMode) return;
  link.send({ action: 'state', state: buildState(settings, (key) => findFace(faces, key).face, epoch), n: ++seq });
}
function scheduleShare() { if (!shareTimer) shareTimer = setTimeout(() => { shareTimer = 0; pushState(); }, 150); }   // at most every 150 ms, so a drag shows live on the other screens

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
let bannerTimer = 0;
let display = null, curEpoch = -1, lastState = -1;
const follow = createFollow();                        // the mouths a screen shows: latest frame, eased, closed when the controller is gone or silent
function showPairBox(code, msg) {
  $('pairbox').hidden = false;
  $('paircode').textContent = code ? code.slice(0, 3) + ' ' + code.slice(3) : '';
  $('pairmsg').textContent = msg;
}

function startDisplayLink() {
  let again = 0;
  link = new Link(relayUrl, {
    open() {
      clearTimeout(bannerTimer); $('banner').hidden = true;
      setPlaying(true);                               // a display is a pure screen: awake while connected
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
        if (st.epoch !== curEpoch) { curEpoch = st.epoch; lastState = -1; follow.reset(); }
        if (!isNewer(m.n, lastState)) return;
        if (Number.isInteger(m.n)) lastState = m.n;
        display = st; $('pairbox').hidden = true;
      } else if (m.type === 'admin_gone') {
        follow.adminGone();
      } else if (m.type === 'admin_back') {
        follow.adminBack();
      } else if (m.type === 'ended' || (m.type === 'error' && m.error === 'unknown_session')) {
        mem.del(SCREEN_KEY); display = null; link.send({ action: 'register' });
      }
    },
    close() {
      if (!display) showPairBox('', 'Connecting… If this stays here, check that Funny Faces is still running on the computer and that the computer is awake.');
      else { clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { $('banner').hidden = false; }, 2000); }
    },
    binary(data) { const f = parseMouth(data); if (f) follow.apply(f, performance.now()); },
  });
  link.start();
}

// The address (and QR code) a screen should open, with its mirror and flip options added.
let tvUrls = [];
function renderTvAddress() {
  const opts = { mirror: $('tvmirror').checked, flip: $('tvflip').checked }, addr = screenAddress(tvUrls[0], opts);
  $('tvurl').textContent = addr;
  try { $('qr').innerHTML = qrSvg(addr); } catch { $('qr').replaceChildren(); /* too long for a QR: the text is still there */ }
  $('tvother').textContent = tvUrls.length > 1 ? 'If that does not work, try: ' + tvUrls.slice(1).map((u) => screenAddress(u, opts)).join('  or  ') : '';
}
for (const id of ['tvmirror', 'tvflip']) $(id).addEventListener('change', () => { if (tvUrls.length) renderTvAddress(); });

async function initRelay() {
  const cfg = await loadConfig();
  relayUrl = cfg && cfg.relay;
  if (cfg && cfg.info && cfg.info.urls.length) {
    tvUrls = cfg.info.urls;
    renderTvAddress();
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
let audio = null, source = null, live = null, stream = null, el = null, tabStop = null;
const mouths = new Mouths();
function ensureAudio() {
  if (!audio) { audio = new AudioContext(); live = source = new LiveSource(audio); }
  if (audio.state === 'suspended') audio.resume();
}
function stopSources() {
  if (tabStop) { tabStop(); tabStop = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (el) { el.pause(); el = null; }
  if (live) { try { live.analyser.disconnect(); } catch { /* not connected */ } source = live; }
}
// A chosen file is analysed once, in this browser, into a mouth track; if that fails the sound is analysed live instead.
const trackCache = new Map();                              // file name, size and option -> track, so a second play does not re-analyse
async function playFile(file) {
  ensureAudio();
  const url = URL.createObjectURL(file), label = file.name;
  try {
    const key = `${file.name}|${file.size}|${file.lastModified}|${$('centre').checked}`;
    let track = trackCache.get(key);
    if (!track) {
      say('Analysing ' + label + '…');
      const buf = await audio.decodeAudioData(await file.arrayBuffer());
      const mid = new Float32Array(buf.length), side = buf.numberOfChannels > 1 ? new Float32Array(buf.length) : null;
      const a = buf.getChannelData(0), b = side ? buf.getChannelData(1) : null;
      for (let i = 0; i < mid.length; i++) { mid[i] = b ? (a[i] + b[i]) / 2 : a[i]; if (side) side[i] = (a[i] - b[i]) / 2; }
      track = await analyze({ mid, side, sampleRate: buf.sampleRate }, { centre: $('centre').checked, gate: settings.adv.gate,
        onProgress: (p) => say(`Analysing ${label}… ${Math.round(p * 100)}%`) });
      trackCache.set(key, track);
    }
    stopSources();
    el = new Audio(url);
    el.loop = true;
    source = new TrackSource(track, () => (el ? el.currentTime : 0));
    await el.play();
    setPlaying(true);
    $('firsthint').hidden = true;
    say('Playing ' + label + ' with a mouth track (' + Math.round(track.data.length / 2 / track.fps) + ' s analysed)');
    return true;
  } catch { return playLive(url, label); }
}
function playLive(url, label) {
  ensureAudio(); stopSources();
  el = new Audio(url);
  el.loop = true;
  const src = audio.createMediaElementSource(el);
  live.connect(src);
  src.connect(audio.destination);
  return el.play().then(() => { setPlaying(true); say('Playing ' + label); return true; }, () => false);
}
async function useMic() {
  try {
    ensureAudio(); stopSources();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    live.connect(audio.createMediaStreamSource(stream));
    $('firsthint').hidden = true;
    setPlaying(true);
    say('Listening to the microphone');
  } catch (e) { say('Could not use the microphone: ' + (e.name || 'error')); throw e; }
}
$('mic').addEventListener('click', () => useMic().catch(() => {}));
// Sound from another tab: the tab plays its own sound, so it feeds the analyser only, never the speakers.
async function useTab() {
  try {
    ensureAudio(); stopSources();
    const cap = await captureTabAudio({ mediaDevices: navigator.mediaDevices, MediaStream }, {
      onEnded: () => { stopSources(); say('Tab sharing stopped'); },
    });
    tabStop = cap.stop; stream = cap.stream;
    live.connect(audio.createMediaStreamSource(stream));
    $('firsthint').hidden = true;
    say('Listening to the shared tab');
  } catch (e) { say(e.code ? TAB_AUDIO_MESSAGES[e.code] : 'Could not capture the tab sound'); throw e; }
}
if (tabAudioSupported()) $('tab').addEventListener('click', () => useTab().catch(() => {}));
else { $('tab').hidden = true; $('tabnote').hidden = false; }
$('file').addEventListener('change', () => {
  const f = $('file').files[0];
  if (!f) return;
  playFile(f).then((ok) => { if (!ok) say('Press play again; the browser blocked autoplay'); });
});

// ---------------------------------------------------------------- menu and full screen
const nav = $('nav');
let mode = 'move';                                   // what the arrow keys do while the menu is hidden
const menuOpen = () => !nav.classList.contains('hidden');
function showMenu(on) { nav.classList.toggle('hidden', !on); if (on) $('play').focus(); }

async function start() {
  if (!stream && !el) {
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

// ---------------------------------------------------------------- size and move
// With edit mode off, drag, pinch, wheel and arrows move and resize the whole group (every pumpkin's quad together).
// With edit mode on, editor.js moves, warps and zooms one pumpkin.
const groupQuads = () => settings.pumpkins.map((p) => p.quad);
/** Place the whole group: x and y as before (-1 to 1 across the stage), size as a multiple of the default. */
function setGroup({ x, y, size }) {
  const A = aspect(), c = [0.5 + settings.x / 2, 0.5 + settings.y / 2];
  let quads = groupQuads();
  if (size !== settings.size) {
    const scaled = scaleAll(quads, size / settings.size, c, A);
    if (scaled === quads) size = settings.size;                  // it would not fit: stay as we were
    quads = scaled;
  }
  const moved = moveAll(quads, (x - settings.x) / 2, (y - settings.y) / 2);
  settings.pumpkins.forEach((p, i) => { p.quad = moved[i]; });
  Object.assign(settings, { size, x: settings.x + (moved[0][0][0] - quads[0][0][0]) * 2, y: settings.y + (moved[0][0][1] - quads[0][0][1]) * 2 });
}
const groupBy = (f) => { setGroup({ x: settings.x, y: settings.y, size: settings.size, ...f(settings) }); syncControls(); persist(); };
for (const k of ['size', 'x', 'y']) $(k).addEventListener('input', () => groupBy(() => ({ [k]: +$(k).value })));

const editor = createEditor({
  canvas, overlay: $('overlay'), pumpkins: () => settings.pumpkins,
  sel: () => sel, changed: () => persist(),
  select(i) { sel = i; syncControls(); renderFaces(); renderPumpkins(); },
  onMode(on) {
    $('overlay').hidden = !on; $('edithint').hidden = !on; $('editbtn').textContent = on ? 'Finish editing' : 'Edit pumpkins';
    canvas.classList.toggle('editing', on);
    if (on) { showMenu(false); toast('Editing: Esc or E to finish'); }
  },
});
$('editbtn').addEventListener('click', () => { if (!screenMode) editor.toggle(); });

const pointers = new Map();
let moved = 0, pinch = 0;
const goFull = () => document.documentElement.requestFullscreen().catch(() => {});
canvas.addEventListener('pointerdown', (e) => {
  if (screenMode) { goFull(); return; }              // a display only needs a tap to go full screen
  if (editor.on) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = 0; pinch = 0;
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || editor.on) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) groupBy((l) => scale(l, d / pinch));
    pinch = d;
  } else if (pointers.size === 1) {
    const [sx, sy] = viewDelta(dx, dy, editor.flags());          // a mirrored or flipped page drags the way you see it
    groupBy((l) => drag(l, sx, sy, innerWidth, innerHeight));
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId); pinch = 0;
  if (!pointers.size) {
    canvas.classList.remove('dragging');
    if (!editor.on && moved < 6 && e.type === 'pointerup') showMenu(!menuOpen());   // a tap shows or hides the menu
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (screenMode || editor.on) return;
  e.preventDefault();
  groupBy((l) => scale(l, Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });
$('reset').addEventListener('click', () => groupBy(() => ({ x: 0, y: 0, size: 0.8 })));

addEventListener('keydown', (e) => {
  if (screenMode) { if (screenKey(e)) return; if (e.key === 'Enter') goFull(); return; }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
  if (editor.on) {
    if (e.key === 'Escape' || ((e.key === 'e' || e.key === 'E') && !typing && !e.metaKey && !e.ctrlKey)) { editor.setOn(false); e.preventDefault(); return; }
    if (typing || menuOpen() && e.target !== document.body) return;
    if (editor.key(e)) return;
  } else if ((e.key === 'e' || e.key === 'E') && !typing && !e.metaKey && !e.ctrlKey) { editor.setOn(true); return; }
  if (menuOpen()) {
    if (e.key === 'Escape') showMenu(false);
    return;                                           // let the menu use its own keys
  }
  const step = e.shiftKey ? 0.05 : 0.02;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key]) {
    e.preventDefault();
    const [dx, dy] = viewDelta(...arrows[e.key], editor.flags());
    if (mode === 'move') groupBy((l) => nudge(l, dx, dy));
    else if (dy) groupBy((l) => scale(l, dy < 0 ? 1.05 : 1 / 1.05));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    mode = mode === 'move' ? 'size' : 'move';
    toast(mode === 'move' ? 'Arrows move the face' : 'Up and down resize the face');
  } else if (e.key === '+' || e.key === '=') groupBy((l) => scale(l, 1.05));
  else if (e.key === '-') groupBy((l) => scale(l, 1 / 1.05));
  else if (e.key === 'Escape' || e.key === 'ContextMenu' || e.key === 'Backspace' || e.key === 'm') showMenu(true);
});

// ---------------------------------------------------------------- drawing
let last = performance.now();
const benching = params.has('bench');            // ?bench=1: measure drawing speed (see bench.js)
if (benching) runBench(stage, findFace(faces, 'starter/flames').face, params);
const meterFill = document.querySelector('#meter i');
const enabledPumpkins = () => settings.pumpkins.filter((p) => p.enabled);

// The voice is measured and sent from a timer, not from the drawing loop: a browser stops the drawing loop in a
// hidden tab, which would stop the other screens' mouths. A worker's timer is not slowed down in the background.
let lastMouths = [], tickAt = performance.now();
function tick() {
  if (screenMode || !source) return;
  const now = performance.now(), dt = Math.min(0.1, (now - tickAt) / 1000);
  tickAt = now;
  lastMouths = mouths.update(source.frame(), dt, now / 1000, settings, enabledPumpkins());
  if (ready && screensN > 0 && now - lastSend >= 66) {
    const v = packMouth(lastMouths), since = now - lastSend;
    // Send when it changed, and every 400 ms while a mouth is open even if it did not (a held vowel): a screen closes a mouth it has not heard about for 1.5 s.
    if (changed(sentMouth, v) || (since >= 400 && v.some((x, i) => i % 3 !== 1 && x > 0))) {
      link.send(mouthFrame(mouthSeq, v)); mouthSeq = (mouthSeq + 1) & 0xffff; sentMouth = v; lastSend = now;
    }
  }
}
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })));
  w.onmessage = tick;
} catch { setInterval(tick, 33); }

// The next frame is always requested first, and a failure while drawing is reported once instead of stopping the loop.
let frameFault = '';
function frame(now) {
  requestAnimationFrame(frame);
  try { draw(now); frameFault = ''; }
  catch (e) {
    const msg = String(e && e.message || e);
    if (msg !== frameFault) { frameFault = msg; console.error('Drawing failed:', e); }
  }
}

function draw(now) {
  if (benching) return;
  stage.watch(now - last, now);                       // Auto quality follows the real time between frames
  stage.setQuality(screenMode ? 'auto' : settings.adv.quality);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;
  let list, look, ms;
  if (screenMode) {                                   // follow what the main screen sent, smoothed between updates
    ms = follow.tick(dt, now);
    list = display && display.pumpkins; look = display;
  } else {
    list = enabledPumpkins().map((p) => ({ face: findFace(faces, p.face).face, quad: p.quad, color: p.color }));
    look = { ...settings, idleDim: settings.adv.idleDim }; ms = lastMouths;
    meterFill.style.width = Math.round(Math.min(1, Math.max(0, ...ms.map((m) => m.energy)) * 1.4) * 100) + '%';
  }
  if (list && list.length) stage.draw(list, ms, look, t, dt);
  else stage.clear();
  editor.draw();
}
requestAnimationFrame(frame);
