# Face Characters

A single static web page that gives a talking face to any audio. Open it, pick a face, point it at a
microphone or an audio file, and the mouth follows the voice. There is no server and no account.
Settings are stored in this browser only (localStorage).

## Run it

Any static host works (an S3 bucket behind CloudFront, GitHub Pages, and so on). Locally:

```bash
python3 -m http.server 8900
```

Then open http://localhost:8900/. The microphone needs HTTPS or localhost.

## Kiosk and Fire TV use

Open `index.html?audio=<url>` (the file on the same site, or a host that allows cross-origin reads).
It starts playing at once when the browser allows it. If the browser blocks autoplay, press the one
focused button (Enter on a remote, or a tap): it plays, goes full screen and hides everything but the
face. Back, Escape or a tap brings the controls back. Other options: `face=<id>`, `color=<hex, no #>`,
`loop=0` to play once. Not yet tested on a real Fire TV.

## Showing the face on other screens

Open the page with `?screen` added on the other display (a TV, for example). It shows a 6-character code.
On the main screen open the Screens tab, type the code and press Add screen. The display then shows the
same character, colour and layout, and its mouth follows the microphone on the main screen. Only the
microphone drives the mouth; play music through other speakers and let the main device hear it.

How it works: the main page sends the character and settings when they change, and a few small mouth
values about 15 times a second while there is sound. Nothing is sent while it is quiet. A small relay
(API Gateway WebSocket, one Lambda, one DynamoDB table; see `relay/`) passes the messages along. Displays
remember their pairing and reconnect by themselves. Sharing needs `config.json` next to `index.html`
(see `config.example.json`); it is not committed.

## Hosting and caching

`node scripts/build.mjs` writes `dist/` with content-hashed script names. Host `dist/` on S3 behind
CloudFront (or any CDN). Scripts and media are served with `max-age=31536000, immutable`, so a repeat
visit loads nothing from the network. Only `index.html` has a short cache (60 seconds, then stale for a
day while it refreshes) because it is the one file that points at the current hashed scripts. Never
overwrite a media file under the same name; give a new recording a new name.

`scripts/deploy.sh` does the upload and the `index.html` invalidation (set `BUCKET` and `DISTRIBUTION`).

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

- No pairing between devices, no shared library, no song pre-analysis.
- Music mixed into the input moves the mouth too. Separating voices needs a model (next step).
- Safari on iOS needs a tap before audio starts and cannot capture tab audio.

## Tests

```bash
node --test tests
```

## Rules

Never commit credentials, tokens, IP addresses or private hostnames. Use placeholders in docs.
