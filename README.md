# Funny Faces

Funny Faces gives a talking face to any sound. Pick a character (jack-o'-lantern, snowman, elf and more), point it
at a microphone or a song, and its mouth moves with the voice. Show it full screen on a TV or projector, or on
several screens at once. Everything runs on your own computer and home network; nothing goes to the internet.

## Quick start for families

You need a Windows or Mac computer, Chrome, and (for a TV) any TV or Fire TV on the same Wi-Fi. About 5 minutes.

**Easiest: the download with everything inside** (no installing anything)
1. On the project's **Releases** page download the zip for your computer (`mac-arm64` for newer Macs, `mac-x64` for older
   Intel Macs, `win-x64` for Windows) and unzip it.
2. Open the unzipped **Funny Faces** folder and double-click **Start Funny Faces**. The first time, Mac and Windows warn
   about a download from an unknown developer; `READ ME FIRST.txt` in the folder shows how to continue past it.
3. A window with two web addresses opens, and Chrome opens the control page. **Leave the window open**: closing it stops
   Funny Faces. If the computer asks to allow network access, choose **Allow**.
4. In Chrome press **Use microphone**, say yes, and talk. The bar moves and the mouth should too.
5. **To use a TV or projector too**, open the **Screens** tab: it shows an address and a QR code. Open the TV's web
   browser (on a Fire TV: Silk) and type that address. The TV shows a 6-character code.
6. Type the code into the Screens tab and press **Add screen**. The face appears on the TV.

**If you only have the source code** (a ZIP of this project, or a clone): install Node.js 22 or newer from
https://nodejs.org (the **LTS** download), open a command window in the folder (Mac: Terminal, type `cd ` and drag the
folder in; Windows: click the folder's address bar, type `cmd`, Enter), type `npm start` and press Enter. Then continue
from step 3 above.

If something goes wrong: the TV page says it cannot connect (allow Funny Faces or "node" in the computer's firewall, and
make sure the computer is awake and on the same Wi-Fi as the TV); the window says Funny Faces is already running (it is:
use the first address); the code is not accepted (it lasts 10 minutes, so reload the TV page for a new one).

## Notes for tinkerers

## Mouth shapes

The mouth uses nine Rhubarb-style shapes: rest, closed, teeth, open, wide open, rounded, puckered, teeth-on-lip and
tongue-up. Live sound picks a shape from the spectrum in the browser, with no model and no download. An audio
file (or `?audio=` link) is analysed once, in the browser, into a small track (one shape and one loudness digit
per 40 ms) that plays in sync with the sound. The "Singer focus" box favors the centre of the stereo mix, where
the singer usually is. Shape logic is in `src/visemes.js`, tracks in `src/track.js`. The G and H shapes appear
only in tracks that carry them; the live classifier uses the other seven.

## Run it from the command line

You need [Node.js](https://nodejs.org) 22 or newer. In this folder:

```bash
npm start
```

It prints two addresses. Open the first one (`http://localhost:8765/`) in Chrome on this computer: that is the
control page. The microphone and tab capture work there with no certificate, because `localhost` counts as secure.
No password is asked on this computer.

### A second screen (a TV, a projector, another computer)

1. On the TV open its browser and go to the second address `npm start` printed, like `http://192.168.1.23:8765/screen`.
2. The TV shows a 6-character code.
3. On the control page open the **Screens** tab, type the code and press **Add screen**.

The TV needs no password and no account, only the code. It remembers the pairing, so after a restart it just
reconnects. Everything stays on your home network. The computer running Funny Faces has to stay on and awake,
and the first time you run it the computer may ask whether to allow incoming connections: allow it, or the TV
cannot reach it.

### Controlling from a phone or another computer

By default only the computer running Funny Faces can open the control page. To open it to your network, start with
`FACES_LAN_CONTROL=1 npm start`. The first person to visit sets a password (using a one-time setup code printed in the terminal, so a neighbour on the Wi-Fi cannot claim it); everyone after that logs in. The
microphone does not work from another device over plain `http`, so use this for sliders and face choice, and keep
the microphone on the computer.

### Docker

```bash
docker build -t funny-faces .
docker run -d -p 8765:8765 -v funny-faces-data:/data funny-faces
```

Inside a container every browser looks like it is on the network, so the container always asks for a password
(first visit sets it, with the setup code in the container logs). Open `http://localhost:8765/` on the host computer so the microphone works.

### Just one screen, nothing to install

`node scripts/build-standalone.mjs` writes `dist/standalone/index.html`, one file you can open in Chrome with no
server (microphone only, no extra screens).

## Kiosk and Fire TV use

Open `/?audio=<url>` (a file on the same server or a host that allows cross-origin reads). It starts playing at
once when the browser allows it. If the browser blocks autoplay, press the one focused button (Enter on a remote,
or a tap): it plays, goes full screen and hides everything but the face. Back, Escape or a tap brings the controls
back. Other options: `face=<id>`, `color=<hex, no #>`, `loop=0` to play once. Not yet tested on a real Fire TV.

## How the screens work

The control page sends the character and look when they change, and three small mouth values about 15 times a
second while there is sound. The server (`server/`, no dependencies) passes them to every paired screen over a
WebSocket. Pairing codes last 10 minutes and work once. Sessions are saved in `FACES_DATA` (default `./data`) so
screens survive a restart. Settings: `PORT` (8765), `HOST` (0.0.0.0), `FACES_DATA`, `FACES_LAN_CONTROL`.

Security in short: a TV can only show; it cannot control anything. Controlling needs either to be on the computer
itself, or (with `FACES_LAN_CONTROL=1`) the password. The server does not use the internet at all.

## What it does today

- Left-hand menu: Play, Faces, Layout, Look. Hide it (or go full screen) and only the face remains.
- Draws the starter faces (taken from the Pumpkin Faces project) on a canvas, full screen.
- Add more faces by importing a face pack (one JSON file, see docs/FACEPACK.md). Packs are validated and kept in this browser; `?pack=<url>` loads one for a single visit.
- Size and move the face: drag it, scroll or pinch to resize, or use the Layout sliders. With the menu hidden, remote arrows move it and Select switches the up and down arrows to resizing.
- Mouth opens with the speech band (150 to 3500 Hz) of the chosen source, with an adaptive quiet cutoff.
- Sources: microphone, or a local audio file.
- Face, colour, glow and sensitivity are remembered in this browser.

## Extra face packs

`packs/christmas.json` has nine faces: four snowmen (classic, top hat, scarf, grumpy), two Christmas trees
(plain and with lights) and three elves (elf, cheeky, jolly). Import it from the Faces tab. It is generated
by `node scripts/make-christmas-pack.mjs`, which is also a handy example for making packs in code.

## Known limits

- One face at a time for now; no shared library.
- Music mixed into the input moves the mouth too. Separating voices needs a model (next step).
- Safari on iOS needs a tap before audio starts and cannot capture tab audio.

## Making the downloads

`node scripts/make-release.mjs --platform mac-arm64` (or `mac-x64`, `win-x64`, `linux-x64`) builds one zip in `release/`: the app, a copy of
Node downloaded from nodejs.org and checked against its published SHA-256, a double-click launcher and a plain-language
READ ME FIRST. Pushing a tag like `v1.0.1` runs `.github/workflows/release.yml`, which builds all four and attaches them to a
GitHub release. The downloads are not code-signed yet, hence the warnings described above.

## Tests

```bash
node --test tests
```

## Rules

Never commit credentials, tokens, IP addresses or private hostnames. Use placeholders in docs (192.168.1.23 above is an example).
