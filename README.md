# Funny Faces

Funny Faces gives a talking face to any sound. Pick a character (jack-o'-lantern, snowman, elf and more), point it
at a microphone or a song, and its mouth moves with the voice. Show it full screen on a TV or projector, or on
several screens at once. Everything runs on your own computer and home network; nothing goes to the internet.

## Quick start for families

You need a Windows or Mac computer, Chrome, and (for a TV) any TV or Fire TV on the same Wi-Fi. About 10 minutes.

1. **Get the files.** On the project page click the green **Code** button, then **Download ZIP**, and unzip it
   (double-click the ZIP). A ready-made app that skips steps 2 to 4 is planned.
2. **Install Node.js** (the small helper program that runs Funny Faces). Go to https://nodejs.org, click the big
   **LTS** download, open it and click Next through the installer.
3. **Open a command window in the unzipped folder.**
   - Mac: open **Terminal** (press Command+Space, type Terminal), type `cd ` (with a space), drag the unzipped
     folder into the window, press Return.
   - Windows: open the unzipped folder, click the address bar at the top, type `cmd` and press Enter.
4. **Type `npm start` and press Enter.** After a few seconds it prints two web addresses. **Leave this window
   open**: closing it stops Funny Faces. If the computer asks to allow network access, choose **Allow**.
5. **On this computer**, open Chrome and go to the first address (`http://localhost:8765/`). Press **Use
   microphone**, say yes when Chrome asks, and speak. The mouth should move.
6. **To use a TV or projector too**, open the TV's web browser (on a Fire TV: Silk) and type the second
   address, like `http://192.168.1.23:8765/screen`. The TV shows a 6-character code.
7. On the computer, open the **Screens** tab, type the code, and press **Add screen**. The face appears on the TV.

If something goes wrong: the TV page says it cannot connect (allow Funny Faces or "node" in the computer's
firewall, and make sure the computer is awake and on the same Wi-Fi as the TV); the window says Funny Faces is
already running (it is: use the first address); the code is not accepted (it lasts 10 minutes, so reload the TV
page for a new one).

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

## Tests

```bash
node --test tests
```

## Rules

Never commit credentials, tokens, IP addresses or private hostnames. Use placeholders in docs (192.168.1.23 above is an example).
