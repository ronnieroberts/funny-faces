# Face Characters

A single static web page that gives a talking face to any audio. Open it, pick a face, point it at a
microphone or an audio file, and the mouth follows the voice. There is no server and no account.
Settings are stored in this browser only (localStorage).

## Run it

Any static host works (an S3 bucket behind CloudFront, GitHub Pages, and so on). Locally:

```bash
python3 -m http.server 8777
```

Then open http://localhost:8777/. The microphone needs HTTPS or localhost.

## What it does today

- Draws the starter faces (taken from the Pumpkin Faces project) on a canvas, full screen.
- Mouth opens with the speech band (150 to 3500 Hz) of the chosen source, with an adaptive quiet cutoff.
- Sources: microphone, or a local audio file.
- Face, colour, glow and sensitivity are remembered in this browser.

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
