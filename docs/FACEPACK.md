# Face pack format (version 1)

A face pack is one JSON file, data only. The app validates it on import: unknown fields are dropped, numbers are clamped, and sizes are capped, so packs can be shared or sold safely.

```json
{
  "format": "pumpkin-face-pack",
  "version": 1,
  "id": "my-pack",
  "name": "My Pack",
  "author": "You",
  "license": "Personal use",
  "faces": [
    {
      "id": "grumpy",
      "name": "Grumpy",
      "layers": [
        { "kind": "shape", "points": [[16,22],[44,36],[40,44],[16,38]],
          "mirror": true, "blink": true, "react": { "dy": -3 } },
        { "kind": "shape", "points": [[50,40],[45,48],[55,48]] },
        { "kind": "mouth",
          "top":  [[22,68],[30,66],[38,68]],
          "open": [[22,72],[30,90],[38,72]],
          "thick": 1.6, "widthRange": [0.88, 1.08] }
      ]
    }
  ]
}
```

Coordinates are a 100 x 100 square: x runs left to right, y runs top to bottom.

## Layers

**shape** is a filled polygon (3 or more points).
- `mirror`: also draw a copy flipped around x = 50, handy for eyes.
- `blink`: squashes vertically when the face blinks.
- `smooth`: rounds the corners into a curve.
- `react.dy`: moves the shape up or down (in units) as the voice gets louder, for eyebrows. Negative is up.

**Fire.** A `shape` can burn and a `mouth` can be made of fire. These are optional fields, so older packs are unaffected.
- `flame` on a shape: `true`, or `{ "height": 12, "intensity": 1 }` (height 0 to 40 units, intensity 0 to 3). The shape glows like a hot coal and flickering flames rise above its top edge. Flames get taller as the voice gets louder, and shrink while the shape blinks.
- `fire: true` on a mouth: the mouth opening is filled with fire, flames rise inside it, and the lip flickers, so even a closed mouth is a line of fire.
- Anything else for `flame` or `fire` is ignored. Fire uses its own colours (white-yellow core, orange, red tips) and animates with time.

**mouth** is a shape that opens with the sound.
- `top`: the edge when closed, left to right (zig-zag points make teeth).
- `open`: the bottom edge when fully open, with the same number of points as `top`.
- `thick`: how thick the mouth is when closed.
- `widthRange`: width scale for low sounds and high sounds, so "ee" and "oh" differ a little.

**path** (version 2 packs) is a line or curve drawn from SVG path data, so a face can be a real line drawing.

```json
{ "kind": "path", "d": "M30 40 C34 34 42 33 47 38", "stroke": 1.4, "mirror": true, "blink": false, "react": { "dy": -3 } }
```

- `"version": 2` must be set on the pack. Version 1 packs keep working unchanged, and a version 2 pack can still mix `shape` and `mouth` layers with `path` layers.
- `d` is SVG path data in the same 100 x 100 square: `M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T` and `Z`, upper or lower case. Arcs (`A`) are not supported; draw them as curves (`C`). Up to 800 steps and 24,000 characters. Coordinates outside -20 to 120 are clamped.
- `stroke` is the line width in units (0 to 10, default 1.2, about 1 to 1.5 reads well on a projector). Lines have round ends and joins.
- `fill: true` also fills the shape (close it with `Z`). A path needs a `stroke` or a `fill`.
- `opacity` (0.1 to 1) dims a line, for fine detail such as shading or the creases round the eyes.
- `mirror`, `blink` and `react.dy` work as they do for `shape`.
- A path drawn in Inkscape, Figma or Illustrator can be pasted in as `d`: use a 100 x 100 canvas, convert arcs and shapes to paths, and set no transforms.

## Limits

Up to 50 faces per pack, 40 layers per face, 200 points per shape. Files over 2 MB are refused.

## Making and using packs

In the app, open **Face packs and presets** and choose **Export Starter Pack** to get a working example to edit.

There are two ways to use a pack:

- **The packs folder.** Copy the `.json` file into the `packs` folder next to the app (the Docker path is `/data/packs`; set
  `FACES_PACKS_DIR` to use another folder), then reload the page. The server lists the files (only `*.json`, at most 20,
  each up to 2 MB) and the page validates each one. A file that fails is skipped and the Faces tab says which file and why.
  Folder packs show as "from the packs folder", are read again on every load, and cannot be removed in the app: delete the file.
- **Add a pack from a file.** The **Add faces** button on the Faces tab keeps the pack in this browser only.

Each `id` must be unique. If a folder pack and a stored pack share an `id`, the folder pack is shown; the built-in pack's `id`
is reserved. Each face on the stage picks its look from the **Face** list.

## Design guidance

Faces are drawn on a 100 x 100 square, and the same face is shown on every screen, so a few habits make the difference between a face that looks alive and one that looks broken.

**Movement.** The mouth is the part that moves most: it blends between `top` (closed) and `open` (fully open) many times a second while the voice is going.
- Keep the open mouth's lowest point within about 35 units of the closed edge (the starter pack uses 14 to 32). More than that and the jaw looks like it falls off.
- Keep the whole face inside roughly x 8 to 92 and y 6 to 94. The app accepts -20 to 120, but anything outside the square is clipped or runs into the next face.
- `react.dy` moves a shape up or down as the voice gets louder. Use 2 to 5 for eyebrows. The limit is 20, but above about 6 the brows bounce and are tiring to watch for a whole song.
- Keep `widthRange` between about 0.7 and 1.2. The limit is 0.3 to 2, but a mouth that swings from narrow to very wide on every syllable looks like a flapping puppet.
- A `thick` of 1 to 2.5 reads well from across a room. Thin lines vanish on a projector.
- Use `blink: true` on eyes only. Everything else should stay still: a face with many things moving at once is hard to read.

**Shapes.** Use few points: 3 to 14 for most shapes, up to about 20 for a mouth (zig-zag teeth need matching points in `top` and `open`). Use `smooth: true` on round shapes instead of adding points, and `mirror: true` so both eyes match. Keep it simple: it is seen from a distance.

**Fire is expensive.** A `flame` on a shape or `fire: true` on a mouth is redrawn many times a second. Use it on at most 3 or 4 layers per face. Eight fire faces on one projector can make the picture stutter on a weak computer; fewer flames helps more than anything else.

**Colour.** A pack has no colours. The person running the show picks the colour on the Look tab, and each face can have its own. Design in one colour: shapes lit on a dark background.

**Do not copy characters.** Do not make faces of cartoon, film or game characters or brand mascots. Faces from your own idea are fine to share; set `license` to say how others may use them.

**Test it small.** Add the pack, put the face on the stage, play a song and watch for a minute. If the mouth looks wrong, reduce the open depth; if the whole face jumps, reduce `react.dy`.

## Making a pack with an AI assistant

Any chat assistant that can write JSON can draft a pack. Copy the prompt below, change the line that says what you want, and paste it in. Save the answer as `something.json`, drop it in the packs folder (see the README, "Adding your own faces"), and reload the page. If the page says the file was skipped, paste that message back to the assistant and ask it to fix the file.

Assistants get coordinates wrong now and then, so expect two or three rounds. Ask for changes in plain words: "bigger eyes, fewer teeth, make the mouth less tall".

```text
Write a "face pack" file for an app called Funny Faces. It is one JSON file. Reply with only the JSON in one code
block, then a short list of any choices you made.

WHAT I WANT: <describe the characters, for example "three monsters: a one-eyed blob, a vampire with fangs, and a
sleepy ghost">. Do not copy any existing cartoon, film, game or brand character.

THE FORMAT
{
  "format": "pumpkin-face-pack",
  "version": 1,
  "id": "short-lowercase-id",
  "name": "Pack name",
  "author": "My name",
  "license": "Personal use",
  "faces": [
    { "id": "face-id", "name": "Face name", "layers": [ ...layers... ] }
  ]
}

Coordinates are on a 100 x 100 square. x runs left to right, y runs top to bottom. Keep every point inside x 8 to 92
and y 6 to 94. Faces are drawn as lit shapes on a dark background in one colour, so there are no colours in the file.

TWO KINDS OF LAYER
1. A filled shape:
   { "kind": "shape", "points": [[x,y],[x,y],[x,y]], "mirror": true, "blink": true, "smooth": false,
     "react": { "dy": -3 } }
   - "points": at least 3 points, normally 3 to 14, forming a closed polygon.
   - "mirror": true also draws a copy flipped around x = 50, so draw only the LEFT half (x below 50) of eyes, brows
     and ears.
   - "blink": true squashes it when the face blinks. Use it on eyes only.
   - "smooth": true rounds the corners into curves. Use it for round shapes instead of adding many points.
   - "react": { "dy": n } moves the shape up or down as the voice gets louder. Use -2 to -5 for eyebrows (negative
     is up) and leave it out for everything else.
   - optional "flame": true, or { "height": 12, "intensity": 1 }, makes flames burn above the shape. Use it on at
     most 3 layers per face because it is slow to draw.
2. A mouth, exactly one per face, listed last:
   { "kind": "mouth", "top": [[x,y], ...], "open": [[x,y], ...], "thick": 1.6, "widthRange": [0.88, 1.08] }
   - "top" is the mouth's edge when closed, listed left to right. Alternating y values a few units apart make teeth.
   - "open" is the same edge fully open, with EXACTLY the same number of points as "top", the same x values, and
     larger y values (the lower lip). The app blends between the two as the person talks.
   - Keep the open edge no more than 35 units below the closed edge. 12 to 30 is good.
   - "thick" is the line thickness when closed (1 to 2.5). "widthRange" is the width scale for [low sounds, high
     sounds]; stay between 0.7 and 1.2.
   - optional "fire": true fills the mouth with fire. It is slow to draw, so use it rarely.

LIMITS (the app rejects a file that breaks them)
- At most 50 faces per pack, 40 layers per face, 200 points per shape. Stay far below that: 4 to 8 layers a face.
- Every face needs at least one layer. A shape needs at least 3 points. A mouth's "top" and "open" need at least 2
  points each and must be the same length.
- Use only the fields listed here. Leave out anything you are not sure about.
- Give every face in the pack a different "id" (letters, digits and dashes only).

DESIGN RULES
- The face is seen from across a room on a projector: bold, simple shapes, big eyes, a big mouth.
- Only the mouth and eyebrows should move much. Keep everything else still.
- Make the faces clearly different from each other (eye shape, mouth shape, teeth), not one face with tiny tweaks.
- Check your own work before replying: matching point counts in each mouth, no point outside the safe area, and
  valid JSON (no comments, no trailing commas).
```
