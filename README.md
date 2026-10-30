# Funny Faces

Funny Faces gives a talking face to any sound. Pick a character (jack-o'-lantern, snowman, elf and more), point it
at a microphone or a song, and its mouth moves with the voice. Show it full screen on a TV or projector, or on
several screens at once. Everything runs on your own computer and home network; nothing goes to the internet.

## Quick start for families

You need a Windows or Mac computer, Chrome, and (for a TV) any TV or Fire TV on the same Wi-Fi. About 5 minutes.

**Easiest: the download with everything inside** (no installing anything)
1. On the project's **Releases** page download the zip for your computer (`mac-arm64` for newer Macs, `mac-x64` for older
   Intel Macs, `win-x64` for Windows) and unzip it.
2. Open the unzipped **Funny Faces** folder and double-click **Start Funny Faces**. The first time, your computer will warn
   about it; see **The first time you open it** below (`READ ME FIRST.txt` in the folder has the same steps).
3. A window with two web addresses opens, and Chrome opens the control page. **Leave the window open**: closing it stops
   Funny Faces. If the computer asks to allow network access, choose **Allow**.
4. In Chrome press **Use microphone**, say yes, and talk. The bar moves and the mouth should too.
5. **To use a TV or projector too**, open the **Screens** tab: it shows an address and a QR code. Open the TV's web
   browser (on a Fire TV: Silk) and type that address. The TV shows a 6-character code.
6. Type the code into the Screens tab and press **Add screen**. The face appears on the TV.

### The first time you open it

Funny Faces is a hobby project, so the app is not signed with a paid developer certificate. Mac and Windows therefore warn
about it the first time. It is safe to continue: Funny Faces runs only on your local network and sends nothing to the internet.

**Mac** ("Start Funny Faces.command" was Not Opened):
- Option A: double-click it and dismiss the dialog. Open **System Settings > Privacy & Security**, scroll down to the
  message about "Start Funny Faces.command", click **Open Anyway**, and confirm.
- Option B: in Terminal run `xattr -dr com.apple.quarantine "<the unzipped Funny Faces folder>"` (type the command, drag the
  folder onto the Terminal window to fill in its path, press Return), then double-click as usual.

**Windows:** if you see "Windows protected your PC", click **More info**, then **Run anyway**.

**Linux:** make the launcher runnable once with `chmod +x start-funny-faces.sh`, then run it.

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
file is analysed once, in the browser, into a small track (one shape and one loudness digit
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
(first visit sets it, with the setup code in the container logs; see Security and privacy for the lockout that all Docker clients share). `docker stop` saves the pairings first. `FACES_MAX_WS_PER_IP` (default 20) controls how many screens one address can open; every Docker client can look like one address, so for more than about 5 screens raise it. Open `http://localhost:8765/` on the host computer so the microphone works.

### Just one screen, nothing to install

`node scripts/build-standalone.mjs` writes `dist/standalone/index.html`, one file you can open in Chrome with no
server (microphone only, no extra screens).

## Faces, voices and advanced settings

- **Up to 8 faces** at once (Faces tab). Each has its own face, can be switched off, and can be nudged, resized and
  given its own colour (sections *Look of this face* and *Position and size*).
- **Who talks** (also on the Faces tab):
  - *All together, in sync*: every face moves with the sound.
  - *Each face listens to its own voice range*: bass, baritone, tenor, alto, soprano, treble ("s" sounds) or the full
    range, each with its own level. Good for songs with several voices.
  - *Take turns*: one face speaks per phrase; the next phrase goes to the next face.
  - *Random after each silence*: a random face starts after every silence, and the others may break in for a moment.
- **Advanced** tab: input sensitivity (dB), output sensitivity (how wide the mouth opens), noise gate, snappiness (how
  fast the mouth reacts and stops), voice focus (ignore drums and bass), mouth shapes (0 = plain open and close) and
  resting brightness for faces that are not talking. Use the Sound in bar on the Play tab to see what they hear.
- A chosen audio file is analysed once in the browser and plays with its mouth track. A prepared song has no separate
  voice ranges, so it plays all together (turns and random still work).

## Sound from another tab

To make the faces talk along with Apple Music, YouTube or any other web page, press **Use another tab's sound** on the
Play tab, choose **Chrome Tab**, pick the tab and tick **Share tab audio**. The tab keeps playing out loud; press
Stop sharing in the browser to end it. This works in Chrome or Edge on a computer (on a Mac only Chrome tabs can share
sound; on Windows a whole screen can too). TV browsers cannot do it: capture on the computer and let the TV screen
follow. Tip: play the music in a Chrome tab and use Voice focus / Voice bands on the Advanced and Faces tabs so
each face follows its own part.

## Projectors: mirror, flip and keep-awake

A projector behind a screen shows a mirrored picture, and a projector mounted upside down shows it upside down.
These options belong to each device, so the projector's own page can have them while the control page does not.

- **Control page:** Look tab, **Output**: *Mirror (rear projection)*, *Flip upside down*, *Keep the screen awake*.
- **Every connected screen, live:** Screens tab, **Every connected screen**: *Mirror all screens* and *Flip all screens*. They
  change the screens straight away, on top of whatever each screen already has. The Look tab boxes above change only the page you are on.
- **Display screens (`/screen`):** add them to the address, for example `/screen?mirror=1&flip=1&awake=0`. The Screens
  tab has two boxes that add `mirror=1` and `flip=1` to the address and QR code for you. The screen remembers them,
  and the keys **M** (mirror) and **F** (flip) change them while it is showing.
- **Mirror** swaps left and right. **Flip** turns the picture a half turn (an upside-down projector). Both together
  turn it top to bottom.
- **Keep awake** asks the browser not to let the screen sleep while faces are showing. It needs a recent browser and a
  secure page (`localhost` or `https`); over plain `http` on a TV it is usually not available, and the page says so.
  In that case turn off the TV or projector's own sleep timer.

## Lining up with real pumpkins

Each face sits on its own four-corner shape, so you can fit a projected face onto a real pumpkin.

1. Project full screen, then press **E** (or **Edit on the stage** on the Faces tab). The menu hides and handles appear on the picked face.
2. Drag a face to move it. Drag a corner to skew it (the face tilts in perspective). Drag a side dot to stretch it that way. The top dot rotates, the bottom ring zooms. The mouse wheel zooms the face under the pointer. Two fingers pinch it on a touch screen.
3. Tab picks the next face, the arrow keys nudge (Shift for bigger steps), + and - zoom, R resets the skew.
4. Press **E** or **Esc** to finish. M brings the menu back.

Faces tab: **Straighten this face** squares up the picked face, **Line all faces up in a row** puts them back in a row, and the Size, Left / right and Up / down sliders under *Whole stage* move and resize all of them together. Screens added from the Screens tab draw the same shapes. A browser without WebGL2 draws faces flat: they still move, zoom and rotate, but skew has no perspective.

## Kiosk and Fire TV use

For a screen that only shows the faces, open `/screen` on it and pair it with the code (see above). It goes full screen
with one press of the remote's Select button or a tap.

## How the screens work

The control page sends the character and look when they change, and three small mouth values about 15 times a
second while there is sound. The server (`server/`, no dependencies) passes them to every paired screen over a
WebSocket. Pairing codes last 10 minutes and work once. Sessions are saved in `FACES_DATA` (default `./data`) so
screens survive a restart. Settings: `PORT` (8765), `HOST` (0.0.0.0), `FACES_DATA`, `FACES_LAN_CONTROL`.

Security in short: a TV can only show; it cannot control anything. Controlling needs either to be on the computer
itself, or (with `FACES_LAN_CONTROL=1`) the password. The server does not use the internet at all.

## What it does today

- Left-hand menu: Play, Faces, Layout, Look. Hide it (or go full screen) and only the face remains.
- Draws the starter faces on a canvas, full screen.
- Add more faces by importing a face pack (one JSON file, see docs/FACEPACK.md). Packs are validated and kept in this browser. Or drop them in the packs folder (see Adding your own faces).
- Size and move the face: drag it, scroll or pinch to resize, or use the Layout sliders. With the menu hidden, remote arrows move it and Select switches the up and down arrows to resizing.
- Mouth opens with the speech band (150 to 3500 Hz) of the chosen source, with an adaptive quiet cutoff and nine mouth shapes.
- Sources: microphone, or a local audio file.
- Faces, colour, glow and the advanced settings are remembered in this browser.

## Extra face packs

`examples/christmas.json` has nine faces: four snowmen (classic, top hat, scarf, grumpy), two Christmas trees
(plain and with lights) and three elves (elf, cheeky, jolly). Add it with the Faces tab or the packs folder (see below). It is generated
by `node scripts/make-christmas-pack.mjs`, which is also a handy example for making packs in code.

## Adding your own faces

A face pack is one `.json` file (the format is in `docs/FACEPACK.md`). There are two ways to add one.

**The packs folder (recommended).** Funny Faces offers every pack file it finds in a folder called `packs`. Nothing is
uploaded; the file stays on your computer.

1. Find the folder.
   - Download (zip): the `packs` folder inside the `Funny Faces` folder, next to `app` and `runtime`.
   - npm or a checkout (`npm start`): the `packs` folder in the project. To use another folder, start with
     `FACES_PACKS_DIR=/path/to/folder npm start`.
   - Docker: the `/data/packs` folder in the container. Mount a folder of yours there, for example
     `docker run -d -p 8765:8765 -v funny-faces-data:/data -v "$PWD/my-packs":/data/packs:ro funny-faces`
     (put your `.json` files in `my-packs`), or copy a file into the data volume's `packs` folder.
2. Copy your pack file (`something.json`) into it. Up to 20 files, 2 MB each.
3. Reload the Funny Faces page. You do not need to restart anything.
4. Open the **Faces** tab. Your packs are listed after the built-in faces, marked "from the packs folder". They are read again on
   every load, so to remove one, delete its file and reload.

If a file cannot be used, the Faces tab shows a notice with the file name and the reason, for example
`my-pack.json: That file is not valid JSON`, and carries on with the others. A pack whose `id` matches one you added
by hand wins over it; the built-in `id` cannot be used.

**Make your own with an AI assistant.** `docs/FACEPACK.md` has a ready-to-paste prompt for your favorite chat assistant,
plus design advice (how far a mouth should open, how much movement is too much, why fire is slow). Describe the characters
you want, save the reply as a `.json` file, and drop it in the packs folder. If the page rejects it, paste the message
back to the assistant and ask it to fix the file.

**Add a pack from a file.** On the Faces tab, **Add faces** picks a file and keeps it in this browser only. Use this for a
one-off try; use the folder for packs you want on every device that controls Funny Faces.

## Known limits

- No four-corner warp yet for lining a projector up with real pumpkins (planned).
- Faces are flat shapes; a prepared song has no separate voice ranges.
- Music mixed into the input moves the mouth too. Separating voices needs a model (next step).
- Safari on iOS needs a tap before audio starts and cannot capture tab audio.

## Security and privacy

- **The server never uses the internet.** It does not call out to anything, and there is no telemetry, tracking or
  analytics. The page and all its code come from your own computer.
- **Who can control what.** On the computer running Funny Faces, the control page needs no password. A TV or other
  screen only gets the screen page and can do nothing until you type its code on the control page. Other devices can
  open the control page only if you start with `FACES_LAN_CONTROL=1`, and then only after a password (set once, using
  a setup code printed in the terminal window).
- **Plain HTTP.** On the home network the page is served over plain `http`, not `https`, so the password is not
  encrypted on its way from a phone to the computer. Anyone who can listen in on your Wi-Fi could read it. Use a password you
  do not use anywhere else, and do not expose Funny Faces to the internet.
- **Guessing is slowed down.** Eight wrong passwords lock an address out for a minute. Five wrong setup codes lock it
  out for 15 minutes, and twenty wrong ones in total make the server print a fresh setup code. While locked out you
  see "Too many wrong tries" with the time to wait. In Docker every browser reaches the server through the same
  address, so one person's lockout applies to everyone until it ends.
- **Limits.** One address may hold about 20 screen connections at once (`FACES_MAX_WS_PER_IP`), and the server
  accepts about 256 connections in all (`FACES_MAX_CONNECTIONS`). Behind Docker all devices count as one address, so raise
  the first number if you have many screens.
- **Forgot the password?** Stop Funny Faces, delete `auth.json` from the data folder, and start it again. The first
  visitor to the control page can then set a new password with the new setup code.
- **Where your data lives.** In the data folder (`./data`, or `FACES_DATA`; in Docker the `/data` volume): `auth.json`
  (the password, stored as a salted hash, and a secret for login cookies) and `sessions.json` (which screens are paired
  and the last look of the faces). Both are readable only by you. Pairings are kept for 30 days. Faces and packs you add
  stay in your browser.

## Making the downloads

`node scripts/make-release.mjs --platform mac-arm64` (or `mac-x64`, `win-x64`, `linux-x64`) builds one zip in `release/`: the app, a copy of
Node downloaded from nodejs.org and checked against its published SHA-256 (its license is included as `runtime/LICENSE-node.txt`, with a `THIRD-PARTY-NOTICES.txt`), a double-click launcher and a plain-language
READ ME FIRST. Pushing a tag like `v1.0.1` runs `.github/workflows/release.yml`, which builds all four and attaches them to a
GitHub release together with a `SHA256SUMS` file (the tag must match the version in `package.json`; `v1.0.1-rc1` makes a test release). The downloads are not code-signed yet, hence the warnings described above.

## Tests

```bash
npm test
```

## Rules

Never commit credentials, tokens, IP addresses or private hostnames. Use placeholders in docs (192.168.1.23 above is an example).

## License

MIT. See `LICENSE`. The downloads bundle Node.js, which has its own license.
