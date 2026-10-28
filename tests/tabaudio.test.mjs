import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTabAudio, tabAudioSupported, TabAudioError, TAB_AUDIO_CONSTRAINTS } from '../src/tabaudio.js';

class FakeTrack {
  constructor(kind) { this.kind = kind; this.stopped = false; this.l = {}; }
  stop() { this.stopped = true; }
  addEventListener(n, f) { this.l[n] = f; }
  removeEventListener(n) { delete this.l[n]; }
  fire(n) { if (this.l[n]) this.l[n](); }
}
class FakeStream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
}
const deps = (getDisplayMedia) => ({ mediaDevices: { getDisplayMedia }, MediaStream: FakeStream });
const codeOf = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof TabAudioError); return e.code; } return null; };

test('returns an audio-only stream and stops the video track', async () => {
  const v = new FakeTrack('video'), a = new FakeTrack('audio');
  let asked;
  const r = await captureTabAudio(deps(async (c) => { asked = c; return new FakeStream([v, a]); }));
  assert.equal(asked, TAB_AUDIO_CONSTRAINTS);
  assert.equal(asked.audio.echoCancellation, false);
  assert.equal(asked.systemAudio, 'include');
  assert.equal(asked.selfBrowserSurface, 'exclude');
  assert.equal(asked.audio.suppressLocalAudioPlayback, false);
  assert.deepEqual(r.stream.getTracks(), [a]);
  assert.ok(v.stopped);
  assert.ok(!a.stopped);
  r.stop();
  assert.ok(a.stopped);
});

test('unsupported browsers', async () => {
  assert.equal(await codeOf(captureTabAudio({ mediaDevices: {}, MediaStream: FakeStream })), 'unsupported');
  assert.equal(await codeOf(captureTabAudio({})), 'unsupported');
  assert.equal(tabAudioSupported({ mediaDevices: {}, userAgent: 'x' }), false);
  assert.equal(tabAudioSupported({ mediaDevices: { getDisplayMedia() {} }, userAgent: 'Chrome' }), true);
  assert.equal(tabAudioSupported({ mediaDevices: { getDisplayMedia() {} }, userAgent: 'Mozilla Silk/100' }), false);
  assert.equal(tabAudioSupported(undefined), false);
});

test('cancelled or denied sharing', async () => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    const e = Object.assign(new Error('x'), { name });
    assert.equal(await codeOf(captureTabAudio(deps(async () => { throw e; }))), 'denied');
  }
  assert.equal(await codeOf(captureTabAudio(deps(async () => { throw new Error('boom'); }))), 'failed');
});

test('no audio ticked stops everything', async () => {
  const v = new FakeTrack('video');
  assert.equal(await codeOf(captureTabAudio(deps(async () => new FakeStream([v])))), 'no-audio');
  assert.ok(v.stopped);
});

test('ended event reports once, and stop() silences it', async () => {
  const a = new FakeTrack('audio');
  let n = 0;
  await captureTabAudio(deps(async () => new FakeStream([new FakeTrack('video'), a])), { onEnded: () => n++ });
  a.fire('ended'); a.fire('ended');
  assert.equal(n, 1);
  const b = new FakeTrack('audio');
  const r2 = await captureTabAudio(deps(async () => new FakeStream([b])), { onEnded: () => n++ });
  r2.stop();
  b.fire('ended');
  assert.equal(n, 1);
});
