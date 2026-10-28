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
is reserved. Each pumpkin picks its face from the **Face** list.
