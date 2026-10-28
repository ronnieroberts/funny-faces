# Changelog

## 1.0.1

- Much faster drawing: eight flame faces went from about 55 ms to about 5 ms per frame (a blurred shadow under the translucent flames was most of the cost). Tiles are redrawn and uploaded only when they change, and are capped by pumpkin count.
- Advanced tab: Quality Auto / Full / Lite. Auto lowers detail when the frame rate stays under about 30 and raises it again carefully; display screens use Auto.
- `?bench=1` and `node scripts/bench.mjs` measure drawing speed.
- Screens: mouth updates now use a compact binary format (about 30 bytes for eight pumpkins instead of about 120), screens close the mouth when the controller disappears, and the control page repeats the mouth while it is held open. The wire format changed, so reload the control page and every screen after updating (see `docs/PROTOCOL.md`).
- A drawing error no longer stops the page from drawing.
- Face packs: drop `.json` files in the `packs` folder (`FACES_PACKS_DIR`, `/data/packs` in Docker) and reload; the old `?pack=<url>` option is removed.
- Renamed to Funny Faces (the stored settings keep their old keys so nothing is lost).
- Up to 8 pumpkins at once, each with its own voice band, turn-taking or random mode.
- Advanced settings for input level, gate, output gain and voice focus.
- Mouth shapes: nine Rhubarb-style shapes chosen live from the spectrum, or from a song (an audio file is
  analysed once in the browser into a small mouth track; optional centre-channel "Singer focus"). Wider mouth range in the
  built-in faces so shapes read clearly.
- Tab audio capture, mirror, flip and keep-awake.
- Four-corner warp for the projection, plus per-pumpkin move, zoom and skew handles.
- Local-first server: LAN screens connect by a short code, with an optional LAN password.
- Packaged downloads for Mac, Windows and Linux with Node bundled, and a Docker image.
- Security hardening of the server and relay.
- MIT license (the LICENSE file is in every download and the Docker image).
