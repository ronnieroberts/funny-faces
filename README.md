# Funny Faces

A single static web page that gives a talking face to any audio. Open it, pick a face, point it at a
microphone or an audio file, and the mouth follows the voice. There is no server and no account.
Settings are stored in this browser only (localStorage).

## Mouth shapes

The mouth uses nine Rhubarb-style shapes: rest, closed, teeth, open, wide open, rounded, puckered, teeth-on-lip and
tongue-up. Live sound picks a shape from the spectrum in the browser, with no model and no download. An audio
file (or `?audio=` link) is analysed once, in the browser, into a small track (one shape and one loudness digit
per 40 ms) that plays in sync with the sound. The "Singer focus" box favors the centre of the stereo mix, where
the singer usually is. Shape logic is in `src/visemes.js`, tracks in `src/track.js`. The G and H shapes appear
only in tracks that carry them; the live classifier uses the other seven.

## Quick start

You need [Node.js](https://nodejs.org) 22 or newer (the "LTS" download). Then, in this folder:

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
`FACES_LAN_CONTROL=1 npm start`. The first person to visit sets a password; everyone after that logs in. The
microphone does not work from another device over plain `http`, so use this for sliders and face choice, and keep
the microphone on the computer.

### Docker

```bash
docker build -t funny-faces .
docker run -d -p 8765:8765 -v funny-faces-data:/data funny-faces
```

Inside a container every browser looks like it is on the network, so the container always asks for a password
(first visit sets it). Open `http://localhost:8765/` on the host computer so the microphone works.

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

## Tests

```bash
node --test tests
```

## Rules

Never commit credentials, tokens, IP addresses or private hostnames. Use placeholders in docs (192.168.1.23 above is an example).
