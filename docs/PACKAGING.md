# Plan: a download that needs no Node and no terminal

Goal: someone with no technical background downloads one thing, double-clicks it, and gets the control page plus
a TV address and QR code. Status: option A (zip with Node inside), the QR code, the first-run hint with a level meter and the "Reconnecting" banner are built (`scripts/make-release.mjs`, `.github/workflows/release.yml`). Options B to D are still plans. The zip has been smoke-tested on one Mac with a stand-in Node; the CI build, Windows and a real download have not been tried. Rough sizes are guesses, not measurements.

## What stands in the way today
- Node.js has to be installed, and `npm start` typed into a terminal (the biggest drop-off in the consumer review).
- Typing the TV address with a remote is painful (needs a QR code or a short address).
- The computer must stay awake; the OS asks about network access; unsigned downloads show scary warnings.

## Options

| | What the user gets | Pros | Cons |
|---|---|---|---|
| **A. Zip with Node inside** | Download, unzip, double-click `Start.command` (Mac) or `Start.bat` (Windows). | Smallest step from today. No Node install. A day or two. | Still a console window, still unsigned warnings, no tray or QR. |
| **B. Single executable (Node SEA)** | One file per OS, double-click. | One file, no install. | Each OS built separately (CI matrix); console window on Windows; unsigned warnings; about 60 to 100 MB. |
| **C. Desktop app (Electron)** | A normal app with a window, tray icon, QR code, "keep awake", auto-update. | Best experience. Does not need Chrome. Can capture system audio directly (Apple Music, YouTube), which fixes tab capture. | About 100+ MB; code signing needed to avoid warnings; most work (1 to 2 weeks). |
| **D. Fire TV app** | An app that opens the screen page full screen. | No typing a URL on the TV. | Needs the server address once, app store or sideloading; a later step. |

## Recommendation
1. **Now:** option A, as a GitHub release asset (one zip per OS with Node bundled), plus a one-page illustrated
   guide. Add to the control page: a QR code and big TV address, a first-run "press Use microphone" hint with an
   input level meter, and a "Reconnecting..." message on the TV page.
2. **Next:** option C (Electron) wrapping the same server. Electron also gives tray status ("2 screens connected"),
   prevents sleep while running, and system-audio capture. Keep the Node server code unchanged so the tinkerer
   path (npm and Docker) stays the same.
3. **Later:** option D once the screen page is proven on a real Fire TV.

## Things to decide or verify
- Signing: macOS needs an Apple developer account (about $99 a year) to notarize; Windows shows SmartScreen
  warnings until the app has a certificate or reputation. Until signed, the guide must show how to open it anyway.
- Firewall: the first run triggers the OS "allow incoming connections" prompt. The app should explain it first.
- Updates: a simple "new version available" check against the GitHub releases page; no automatic install at first.
- License and distribution: the repo is private, so a public download needs a decision on where releases live.
- Test on: Windows 11, an older Mac, a real Fire TV, a Wi-Fi network with device isolation turned on (the TV cannot
  reach the computer there; the app should detect and say so).
