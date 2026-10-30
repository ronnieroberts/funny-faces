# Wire protocol

The control page ("main screen") measures the voice and sends mouths to the Funny Faces server, which forwards them to every
paired display screen (`/screen`). The server is a dumb broadcast. A screen is a pure function of the latest look and the
latest mouths, redrawn every frame. Everything is one WebSocket at `/ws` on the same host that served the page.

## Messages

| Message | Direction | Encoding | Rate |
| --- | --- | --- | --- |
| `register`, `pair`, `admin`, `screen`, `end`, `ping` | page to server | JSON text | rare |
| `state` (the look: faces, colour, size, and `screenOutput` {mirror, flip} for every screen) | control page to server to screens | JSON text, `{action:'state', state, n}` then `{type:'state', state, n}` | when the look changes |
| `code`, `paired`, `ready`, `screens`, `ended`, `error` | server to page | JSON text | rare |
| `admin_gone`, `admin_back` | server to screens | JSON text | when the control page leaves or returns |
| **mouths** | control page to server to screens | **binary** | about 15 a second while anything moves |

## Mouth frame

```
byte 0      0x4D ('M')
bytes 1-2   sequence number, unsigned 16 bit, big endian; wraps 65535 -> 0
then        3 bytes per face, 1 to 8 faces: open, bright, energy (each 0..255)
```

Length is `3 + 3k` bytes: 6 for one face, 27 for eight. The server rejects anything else (wrong type byte, wrong length,
nine faces) and forwards valid frames to every screen of the session as the identical bytes, never decoding the values.
Binary messages over 64 bytes close the connection (1009). A screen keeps a frame only if its sequence number is newer than the
last one, compared across the wrap (1 to 32767 steps ahead). Look (`state`) counters stay plain increasing integers.

## Freeze handling

The screen eases its mouths closed when the server sends `admin_gone`, and when it has had no mouth frame for 1.5 seconds while
a mouth was open. To keep a held vowel open, the control page resends the current mouth every 400 ms while any face's open or
energy is non-zero, even if unchanged. A quiet room sends nothing. `admin_back` (or any new frame) resumes.

## Size on the wire

Including WebSocket framing (control page to server is masked: 6 byte header up to 125 bytes of payload; server to screen is
unmasked: 2 byte header):

| Faces | Before (JSON) up / down | Now (binary) up / down |
| --- | --- | --- |
| 1 | 47 / 41 bytes | 12 / 8 bytes |
| 8 | 124 / 118 bytes | 33 / 29 bytes |

## Why WebSocket

One long-lived connection keeps latency to a single network hop with no per-update request overhead, works from any browser on
a TV, and lets the server push `admin_gone` the moment the controller leaves. Plain HTTP polling would add a request and its
headers to each update; UDP-style transports (WebRTC data channels) add pairing machinery for no gain on a home network.
Binary frames cut the payload to the minimum while control messages stay readable JSON.
