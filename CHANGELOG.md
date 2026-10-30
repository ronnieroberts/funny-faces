# Changelog

## Unreleased

- Editing on the stage shows an alignment grid on the stage and on every connected screen, with a Grid slider in the top right to change the cell size. It goes away when you finish editing.

## 1.0.5

- Mirror this face (Faces tab, *Look of this face*): each face can look the other way, for example two faces looking at each other. It travels to the other screens.

- Mirror and flip on the Look tab now also apply to every connected screen (they set Mirror all screens and Flip all screens). Keep awake still applies to the page you are on.

## 1.0.4

- Mirror and flip for the other screens: the Screens tab has *Mirror all screens* and *Flip all screens*, which change every connected screen at once. Before, mirroring on the control page (Look tab) only affected that page, and a screen only took mirror and flip from its address.

## 1.0.3

- A screen that loses its connection now frowns (the mouth closes and the face droops) until it reconnects.
- The cat face now looks like a cat.
- The control page now has one Faces tab (Play, Faces, Look, Advanced, Screens): pick a face with the chips at the top, then use the fold-out sections Look of this face, Position and size, Whole stage and Who talks. Which sections are open, and which face is picked, is remembered.
- Adding a face no longer rearranges the faces already placed. "Line all faces up in a row" does that on request.
- Own colour shows the shared colour until set, and "Use shared colour" clears it.
- Touch: a "Finish editing" button while editing on the stage, and on phones the menu is a bottom sheet so the stage stays visible.
- The page says "face" instead of "pumpkin" in its wording.
- First-run help for the unsigned downloads: `READ ME FIRST.txt` and the README now give clear steps for the Mac "Not Opened" (Gatekeeper) message (Open Anyway in System Settings, or `xattr -dr com.apple.quarantine`), Windows SmartScreen and Linux (`chmod +x`), and say plainly that the app is unsigned because it is a hobby project and runs only on the local network.

## 1.0.2

1.0.1 was only the rename to Funny Faces; this is the first full release.

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
