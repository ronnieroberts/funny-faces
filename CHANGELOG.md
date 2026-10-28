# Changelog

## 1.0.1

- Face packs: drop `.json` files in the `packs` folder (`FACES_PACKS_DIR`, `/data/packs` in Docker) and reload; the old `?pack=<url>` option is removed.
- Renamed to Funny Faces (the stored settings keep their old keys so nothing is lost).
- Up to 8 pumpkins at once, each with its own voice band, turn-taking or random mode.
- Advanced settings for input level, gate, output gain and voice focus.
- Mouth shapes: nine Rhubarb-style shapes chosen live from the spectrum, or from a song (an audio file or `?audio=` link is
  analysed once in the browser into a small mouth track; optional centre-channel "Singer focus"). Wider mouth range in the
  built-in faces so shapes read clearly.
- Tab audio capture, mirror, flip and keep-awake.
- Four-corner warp for the projection, plus per-pumpkin move, zoom and skew handles.
- Local-first server: LAN screens connect by a short code, with an optional LAN password.
- Packaged downloads for Mac, Windows and Linux with Node bundled, and a Docker image.
- Security hardening of the server and relay.
- MIT license (the LICENSE file is in every download and the Docker image).
