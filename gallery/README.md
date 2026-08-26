# finnart

A gallery for Finn's drawings — one at a time, most recent first.

The front page shows the newest drawing, hanging in a picture frame on a gallery wall,
with a museum placard beside it. Arrows move back through the collection
chronologically. That is the whole site.

## Running it

```
python3 serve.py
```

Then open <http://localhost:8766>. The bench is at `/preview.html`.

Serve it rather than opening `index.html` directly — ES modules are blocked by CORS on
`file://`, and the navigation uses `history.pushState`, which throws there. There is no
build step and nothing to install.

| | |
|---|---|
| `python3 serve.py [port]` | dev server, default 8766 |
| `npm test` | the pure modules, via `node --test` |
| `node tools/manifest.js` | measure anything new in `art/` and print manifest stubs |

## Adding a drawing

1. Put the image in `art/`, named `YYYY-MM-DD-some-slug.jpg` — the date is the day it
   was **drawn**, not the day it was photographed.
2. Run `node tools/manifest.js`. It measures the file and prints a ready-to-paste entry.
3. Paste it into the `artworks` array in `data/artworks.json` and fill in the words:
   title, medium, dimensions, and a note about the piece.

It becomes the front page automatically, because it is the newest. The frame picks
itself from the drawing's id, and the artist's age on the placard is computed from the
`birthDate` in `config`.

Do not type the width and height by hand. The layout is chosen entirely from those two
numbers, and a wrong one does not error — the frame just comes out the wrong shape.

`tools/manifest.js` also reads EXIF orientation, which matters more than it sounds: a
phone photo of a portrait drawing records *landscape* dimensions in its header and is
rotated by the browser at render time. Measuring by hand gets this wrong every time.

## Layout of the repo

```
index.html         the app — one artwork, two arrows, one placard
preview.html       the visual bench: every frame, every ratio, the clamp under duress
css/               base (tokens) · wall · artwork · frame-styles · placard · nav
js/                app + render + preload, the data switchboard, and seven pure modules
test/              one spec per pure module
tools/             dev-only; never served
data/artworks.json the collection
art/               the drawings
```

## The frames

Six: plain oak, thin black, matted white, brushed metal, walnut, and gilt baroque. The
first five are pure CSS. Baroque is a drawn SVG, because carved gilt is not geometric
and CSS cannot fake it convincingly.

A drawing always hangs in the same frame — the choice is a hash of its id, so a link you
send someone looks the way it looked to you. To pin a particular piece to a particular
frame, set `"frame": "walnut"` on it in the manifest.

## Where the data lives

`data/artworks.json` today. `js/data.js` is a switchboard with a PocketBase
implementation already sitting behind it, so moving the collection into a database later
is a one-line change and the frontend does not move.

See `CLAUDE.md` for the architecture, the JSON contract, and the handful of rules that
are load-bearing.

## The icon

`assets/icon-source.svg` is the gallery's own mark — a framed work on the wall, in the
app's palette. Deliberately *not* one of Finn's drawings: putting a particular piece on a
home screen implies that piece is the app, and the collection is meant to change.

Replace it by dropping a new `assets/icon-source.svg` or `.png` and running:

```sh
python3 tools/make-icons.py
```

It prints which source it used. With neither present it falls back to a drawing, so it
always produces something.

Two things to know if you supply an SVG:

- **Draw its own background.** `qlmanage` rasterises SVG onto opaque white, so a
  transparent source arrives with its transparency already gone.
- **Compose its own margin.** The script adds none. A round home-screen mask keeps only
  the middle ~71%, so anything that must survive belongs well inside the square.
