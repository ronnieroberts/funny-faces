// Capture the sound of another browser tab (or window, or the whole system) with getDisplayMedia.
// Browser parts are passed in so the logic is tested with fakes.

export class TabAudioError extends Error {
  constructor(code, message) { super(message); this.name = 'TabAudioError'; this.code = code; }
}

export const TAB_AUDIO_MESSAGES = {
  unsupported: 'Works in Chrome or Edge on a computer. A TV browser cannot capture sound from another tab; use the computer to capture and let the TV follow.',
  denied: 'Tab sharing was cancelled or not allowed',
  'no-audio': 'No sound was shared. Choose Chrome Tab, pick the tab, and tick Share tab audio',
  failed: 'Could not capture the tab sound',
};

// What we ask for: raw sound for the analyser, and the tab keeps playing out loud.
export const TAB_AUDIO_CONSTRAINTS = {
  video: true,                                     // browsers refuse audio-only; the video is dropped at once
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
  systemAudio: 'include',
  selfBrowserSurface: 'exclude',
};

/** True when this browser can capture display audio (not Fire TV/Silk, not iOS Safari). */
export function tabAudioSupported(nav = globalThis.navigator) {
  if (!nav || !nav.mediaDevices || typeof nav.mediaDevices.getDisplayMedia !== 'function') return false;
  return !/\bSilk\b|AFT[A-Z]|Android TV|\bTV\b/i.test(nav.userAgent || '');
}

/**
 * Ask the user to share a tab and return { stream, stop } where stream holds only the audio track.
 * deps: { mediaDevices, MediaStream }. opts.onEnded runs when the user presses Stop sharing.
 * Throws TabAudioError with code 'unsupported', 'denied', 'no-audio' or 'failed'.
 */
export async function captureTabAudio(deps, opts = {}) {
  const md = deps && deps.mediaDevices;
  if (!md || typeof md.getDisplayMedia !== 'function') throw new TabAudioError('unsupported', TAB_AUDIO_MESSAGES.unsupported);
  let shared;
  try {
    shared = await md.getDisplayMedia(TAB_AUDIO_CONSTRAINTS);
  } catch (e) {
    const name = e && e.name;
    const code = name === 'NotAllowedError' || name === 'AbortError' || name === 'SecurityError' ? 'denied' : 'failed';
    throw new TabAudioError(code, TAB_AUDIO_MESSAGES[code]);
  }
  const audioTracks = shared.getAudioTracks();
  shared.getVideoTracks().forEach((t) => t.stop());          // only the sound is wanted
  if (!audioTracks.length) {
    shared.getTracks().forEach((t) => t.stop());
    throw new TabAudioError('no-audio', TAB_AUDIO_MESSAGES['no-audio']);
  }
  const track = audioTracks[0];
  const stream = new deps.MediaStream([track]);
  let done = false;
  const onEnded = () => { if (!done) { done = true; if (opts.onEnded) opts.onEnded(); } };
  track.addEventListener('ended', onEnded);
  const stop = () => {
    done = true;
    track.removeEventListener('ended', onEnded);
    audioTracks.forEach((t) => t.stop());
  };
  return { stream, stop };
}
