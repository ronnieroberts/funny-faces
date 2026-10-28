// Output options that belong to one device (not shared through the relay): mirror for rear projection,
// flip for an upside-down projector, and keeping the screen awake. The CSS lives in index.html and
// reads the data-mirror / data-flip attributes this sets on <body>.
import { sanitizeOutput } from './settings.js';

const SCREEN_KEY = 'face-characters.output.v1';       // display screens keep their own, apart from the main page

const flag = (v) => (/^(1|true|on|yes)$/i.test(v) ? true : /^(0|false|off|no)$/i.test(v) ? false : undefined);

/** ?mirror=1&flip=1&awake=0 -> only the options that were given. */
export function parseOutputParams(params) {
  const out = {}, m = flag(params.get('mirror')), f = flag(params.get('flip')), a = flag(params.get('awake'));
  if (m !== undefined) out.mirror = m;
  if (f !== undefined) out.flip = f;
  if (a !== undefined) out.keepAwake = a;
  return out;
}

/** Show the options on the page: the body attributes drive the CSS in index.html. */
export function applyOutput(output, body) {
  for (const [k, on] of [['mirror', output.mirror], ['flip', output.flip]]) {
    if (on) body.dataset[k] = '1'; else delete body.dataset[k];
  }
}

/** The address a screen should open: base like http://host:8765, plus /screen and the options that are on. */
export function screenAddress(base, { mirror = false, flip = false } = {}) {
  const q = [mirror && 'mirror=1', flip && 'flip=1'].filter(Boolean).join('&');
  return `${base}/screen${q ? '?' + q : ''}`;
}

/** A display remembers its options on that device; the URL wins on first load and is then remembered. */
export function loadScreenOutput(params, storage = globalThis.localStorage) {
  let saved = null;
  try { saved = JSON.parse(storage.getItem(SCREEN_KEY)); } catch { /* none yet */ }
  const out = sanitizeOutput({ ...sanitizeOutput(saved), ...parseOutputParams(params) });
  saveScreenOutput(out, storage);
  return out;
}
export function saveScreenOutput(out, storage = globalThis.localStorage) {
  try { storage.setItem(SCREEN_KEY, JSON.stringify(sanitizeOutput(out))); } catch { /* private mode: just forget */ }
}

/** Plain words for the wake-lock state; null when there is nothing to say. */
export function awakeMessage(state) {
  if (state === 'unsupported') return "This browser cannot keep the screen awake (it needs https or localhost). Turn off the TV or projector's own sleep timer instead.";
  if (state === 'denied') return "The browser would not keep the screen awake. Turn off the TV or projector's own sleep timer instead.";
  return null;
}

/** Screen wake lock. State is 'off', 'on', 'unsupported' or 'denied'. The browser drops the lock when the tab
 *  is hidden, so it is asked for again when the tab shows again. nav and doc are injectable for tests. */
export function createWakeLock(nav, doc) {
  let sentinel = null, wanted = false, state = 'off', busy = false;
  const api = { onchange: null, get state() { return state; }, get wanted() { return wanted; }, acquire, release };
  const set = (s) => { if (s !== state) { state = s; if (api.onchange) api.onchange(s); } };

  async function request() {
    if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== 'function') return set('unsupported');
    if (sentinel || busy || doc.visibilityState === 'hidden') return;   // a hidden tab is asked again when it shows
    busy = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!wanted) { s.release(); return; }               // stopped while we were waiting
      sentinel = s;
      s.addEventListener('release', () => { if (sentinel === s) { sentinel = null; if (wanted) set('off'); } });
      set('on');
    } catch { set('denied'); } finally { busy = false; }
  }
  async function acquire() { wanted = true; await request(); }
  async function release() {
    wanted = false;
    const s = sentinel; sentinel = null;
    if (s) { try { await s.release(); } catch { /* already released */ } }
    if (state !== 'unsupported') set('off');
  }
  doc.addEventListener('visibilitychange', () => { if (wanted && doc.visibilityState === 'visible') request(); });
  return api;
}
