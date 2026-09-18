# finnart

A gallery for Finn's drawings. One artwork at a time — the most recent on the front
page — with arrows to move back through the collection, the way a comic strip archive
works. The drawing hangs in a picture frame, the frame hangs on a wall, and a museum
placard beside it gives the title, the artist, the year, the materials and a note about
where the thing came from.

The tone is the point. A crayon dinosaur is treated with the full seriousness of a
permanent collection: the artist has an age, the work has an accession number, and the
wall text records what he actually said about it. Nothing here should wink at that.

## Core principles

**No framework, no bundler, no build step, no dependencies.** Pure static files served
as-is. `package.json` exists only so node runs the tests as ES modules; it has no
`dependencies` key and should never grow one. This is the same rule scrapbook runs
under, for the same reason: a site with no build cannot rot between the day it is
written and the day someone opens it again.

**One artwork on the wall at a time.** There is no grid, no thumbnail strip, no "browse
all". The whole idea is that a visitor looks at one drawing the way they would in a
gallery, and has to decide to go and see the next one.

**Nothing wraps.** Arrowing past the oldest drawing does not loop round to the newest.
Reaching the beginning of the collection is a real thing that should feel like arriving
somewhere, and an arrow that always works tells you nothing about where you are.

**The frontend consumes the JSON contract and nothing else.** Only `js/data-static.js`
and `js/data-pb.js` may know where a drawing came from. Everything upstream of
`js/data.js` sees the same shape either way.

**Purity where it can be tested.** `collection.js`, `frames.js`, `baroque-frame.js`,
`placard.js`, `art-fit.js`, `gesture.js`, `deep-link.js` and `tools/image-size.js` have
no DOM, no fetch and no randomness. They say so in their header comments, and they are
the only things with tests. Everything decided in those files is decided *before* it
reaches the DOM, which is what keeps `render.js` down to a loop of `setProperty`.

**Only `transform` and `opacity` ever animate.** Never a layout property. `base.css`
carries a global `prefers-reduced-motion` reset.

## Stack

| | |
|---|---|
| Markup | one `index.html`, updated in place |
| Styles | six hand-written CSS files, linked individually, no `@import` |
| Script | vanilla ES modules |
| Data | `data/artworks.json` today; PocketBase later, behind `js/data.js` |
| Tests | `node --test`, no framework |
| Server | `serve.py`, for `Cache-Control: no-store` |

## Running it

```
python3 serve.py          # http://localhost:8766
npm test                  # the pure modules
node tools/manifest.js    # measure anything new in art/
```

Serving over HTTP is not optional: ES modules are blocked by CORS on `file://`, and
`history.pushState` throws there.

## The JSON contract

`data/artworks.json` is `{config, artworks}`. Rules that are load-bearing:

- **`image.src` is a URL the browser can use as-is.** No `imageBase`, no path joining in
  the frontend. This single rule is what makes the PocketBase swap free — `data-pb.js`
  builds a full `/api/files/…` URL and nothing downstream can tell the difference.
- **`image.width` and `image.height` are mandatory.** The clamp that sizes the assembly
  needs the ratio *before* the file loads, or the frame visibly pops from one shape to
  another as the image arrives. Measure them with `tools/manifest.js`; do not type them.
- **`createdOn` is when it was drawn**, not when it was photographed. It orders the
  collection and it drives the age on the placard.
- **`alt` is not `note`.** The note is wall text for someone who can see the drawing;
  alt describes the drawing for someone who cannot. Neither works as the other.
- **There is no `age` field on the static manifest.** Age is derived from `birthDate` in
  config, so correcting that one date corrects every placard at once. The PocketBase path
  cannot do that — `birthDate` is a child's and stays on the scrapbook's private config —
  so the studio stamps `ageMonths` at save time instead. `placard.js` takes either and
  prefers the derived one.

- **The age is in months.** `ageLabel` renders "5 months", "1 year 1 month", "6 years 3
  months"; a whole number of years drops the months rather than saying nought of them.
  Between four and five there are eleven other answers, and which one a drawing belongs
  to is most of why the age is on the label at all.
- `frame` overrides the frame for one piece. `yearLabel` overrides a derived year.
  `accession` overrides a derived accession number. All three are normally `null`.

## The framed assembly

Four nested boxes, and they are not merged on purpose:

```
.artwork   shrink-wraps everything; carries the per-piece custom properties
.frame     padding = the moulding band; background = the moulding face
.mat       padding = the mat reveal;   background = mat paper
.window    the ONLY element with a width and an aspect-ratio
```

The moulding is **padding, not a border**, because a border cannot carry a background
and walnut grain and brushed metal are gradients. `.window` has no padding and no border
so that `aspect-ratio` governs the drawing itself rather than the drawing plus chrome.

**The clamp** (`css/artwork.css`) is the hardest thing here and the thing most likely to
break silently. The assembly has two budgets — the gallery's width and its height — and
only one of them can be written as a percentage, because `100%` in a width calculation
always means width. So `.gallery` is a `container-type: size` element and the clamp uses
container query units to get both axes as lengths. The second arm of the `min()`
converts the height budget into a width through the aspect ratio; that is what makes a
tall portrait shrink rather than run off the bottom of a phone.

Two things about that will bite:

- **`.gallery` must sit in a row with a definite height and must not be aligned.**
  `container-type: size` implies `contain: size`, so its contents stop contributing to
  its own height. Any `align-items` other than the default `stretch` therefore sizes it
  to a content height of *zero*, and every artwork collapses to nothing with no error.
  This has already happened once; the note is in `base.css`.
- **The clamp must not have a real minimum.** `max(140px, min(…))` looks prudent and
  quietly beats the height budget, overflowing every tall piece in a short container.
  It is `max(0px, …)`, purely so a negative value cannot invalidate the declaration and
  drop the image back to its natural size. Section 3 of `preview.html` exists to catch
  exactly this.

**Chrome scales with the viewport, never with the artwork.** Real moulding stock is a
constant width; a small sketch and a large canvas in the same room have the same frame.
Proportional chrome is the single thing that makes CSS picture frames look fake — and it
is also circular, since `--frame-w` derived from the window width makes the window width
depend on itself. The one artwork-dependent nudge is `matScale()`, which tapers the mat
past about 2.6:1 so a panorama does not end up with a mat wider than the drawing is tall.

## Frames

Six styles, registered in `js/frames.js` and styled one block each in
`css/frame-styles.css`. A style block may only change variables, never structure — that
is what keeps adding a frame to ten lines and a registry entry.

Five are pure CSS. **Gilt baroque is a drawn SVG**, handed to `border-image` as a data
URI, because carved gilt is not geometric and CSS cannot fake it. It lives in JS rather
than in the stylesheet for one specific reason: **CSS custom properties and
`currentColor` do not cross into a `data:` URI**, so recolouring it has to happen by
interpolating colours into the markup. `js/baroque-frame.js` documents the eight
`border-image` traps; the two that cost real time were `border-style: none` painting
nothing at all, and a pre-escaped `%23` in the markup becoming `%2523` once the encoder
escaped `%` first, which broke every internal reference and rendered a bare gold band.

**Which frame a drawing gets is a hash of its id**, so a piece is always in the same
frame — a link someone shares looks the same to whoever opens it, and coming back feels
like a gallery rather than a slot machine. `assignFrames` then keeps neighbours from
repeating, because only one artwork is ever on screen and a repeat is felt across a
click as "the page didn't change".

**`assignFrames` takes the collection OLDEST FIRST, and that order is load-bearing.** A
new drawing is always the newest; in a newest-first pass it would land at index 0 and
the no-repeat chain would ripple through the whole collection, changing the frame on
every piece anyone had already bookmarked. Oldest-first means a new piece can only be
influenced by history, never influence it. There is a test named after this.

## The wall

`css/wall.css` is one selector and nothing but background properties, so replacing the
plaster with a photograph is replacing `--wall-layers` with a `url()`. No other file
knows the wall exists.

Everything is lit from the **upper left, about 30° up**. Every shadow offsets
down-and-right, every highlight sits top-left, and the placard uses the same shadow at
about 40% strength. That consistency does more than any individual effect.

Two details worth not undoing: the noise tile needs `stitchTiles="stitch"` or
`feTurbulence` restarts its lattice at each tile edge and a grid appears across the
wall; and every fade-to-nothing names its own colour at alpha 0 rather than
`transparent`, which is transparent *black* and greys out through the middle of a ramp.

Glass glare is opt-in per frame style (`--glass`), off by default. Walnut and plain read
as unglazed canvas frames, and the mix of glazed and unglazed is a lot of what stops a
wall looking like a template. It is also the legibility escape hatch, since glare over
pale crayon is where the effect hurts.

## Navigation

Oldest on the left, newest on the right — that settles every direction question at once.
Index 0 is the newest and is the landing page.

- `←` is **earlier work** (`+1`), `→` is **later work** (`−1`). The labels say "Earlier"
  and "Later", not "Previous" and "Next", because in a chronological archive "previous"
  is genuinely ambiguous and it is the only label a screen reader gets.
- **Never use the `disabled` attribute on the arrows.** A disabled button that currently
  has focus drops that focus to `<body>`, so the visitor's next arrow key goes nowhere —
  keyboard navigation dies silently at the end of the collection, which is exactly where
  someone is pressing an arrow repeatedly. Use `aria-disabled` and a no-op.
- Deep links are `?art=<id>`, a query and not a fragment: a fragment competes with
  in-page anchors and with scroll-to-element, and PocketBase ids drop into a query
  unchanged. The newest piece lives at the bare `./` and nowhere else, so the link
  people share does not rot the day a new drawing arrives.
- Swipe is **touch and pen only**. A mouse drag across the picture is someone trying to
  select or save it, and turning the page out from under them is startling.

**The crossfade must not be sequenced off `transitionend`.** The assembly's *size*
changes between a portrait and a landscape piece, and size cannot be animated, so the
swap happens at zero opacity — but `base.css` disables every transition under
`prefers-reduced-motion`, and a transition that never runs never fires `transitionend`.
Navigation would dead-lock for exactly the visitors who need it to work. It is driven by
a `setTimeout` whose duration is `0` under Reduce Motion.

## Colour

Warm throughout — a single cool grey anywhere makes the wall read as a screen again.
Tokens live once, in `:root` in `css/base.css`, as `--x-rgb` channel triples plus
`--x: rgb(var(--x-rgb))`, with a separate `--x-ink` for anything read as text.

Brass is the case that pair exists for: `--brass` reaches only 2.6:1 and is for the rule
under the placard title; `--brass-ink` is 5.1:1 and is for the credit line. Check WCAG AA
(4.5:1) against `--plate` when changing any of it.

## Adding a drawing

1. Put the file in `art/`, named `YYYY-MM-DD-some-slug.ext`.
2. `node tools/manifest.js` and paste the stub into `data/artworks.json`.
3. Write the words. The note is the part that matters — what he said about it, what it
   was made on, what was going on that week.

Nothing else. The frame picks itself, the age computes itself, the accession number
derives itself, and the piece becomes the front page because it is the newest.

## When adding a frame style

Update `FRAMES` in `js/frames.js`, add one `[data-frame="…"]` block to
`css/frame-styles.css`, and check it in section 1 of `preview.html`. Say in `suits`
which orientations it flatters — it is a preference, not a restriction, and every frame
must stay reachable or the no-repeat sequencer can end up with nowhere to go.

## preview.html

The visual bench. It renders every frame, every ratio, and the clamp in containers of
three different heights, through the **real** modules and the **real** stylesheets — a
bench that reimplements any of it stops testing the app the moment either side changes.
Section 3 is not decorative: it is the only thing that catches a clamp regression, and
it has already caught one. The quick check is to run this in the console and expect zero:

```js
[...document.querySelectorAll('.cell')].filter((c) => {
  const b = c.getBoundingClientRect(), a = c.querySelector('.artwork').getBoundingClientRect();
  return a.left < b.left - .5 || a.right > b.right + .5
      || a.top < b.top - .5 || a.bottom > b.bottom + .5;
}).length
```

## Where the app is mounted

The gallery is built to be served from a subpath — `/gallery/` on the same origin as
the scrapbook — as well as from the root. Nothing in `js/` resolves a URL against the
document; `js/paths.js` derives the app root from `import.meta.url`, and the manifest
fetch, the artwork `src` and the history entries all go through it. That is also what
lets one call site handle both sources: `fromRoot()` returns an absolute URL unchanged,
so a relative path from `artworks.json` and a full `/api/files/...` URL from
`data-pb.js` both come out right.

**The mount point must have a trailing slash, and that has to be guaranteed by the
server.** This is not something the app can fix for itself, and it is worth
understanding why before anyone tries. At `/gallery` without the slash, the browser
resolves `index.html`'s own `<link>` and `<script>` against `/`, so `css/base.css` and
`js/app.js` 404 and the app never boots — `js/paths.js` is never reached, because the
module that imports it never loads. The only ways out are a `<base>` tag or
root-absolute hrefs, and both hard-code the mount point and break `serve.py` at the
root. So: serve a redirect from `/gallery` to `/gallery/`.

What `paths.js` buys, then, is not booting at the wrong URL — it is everything after
boot. Before it, walking back to the newest drawing pushed `./`, which at any
non-root mount resolved to `/` and pointed the gallery's own landing link at the root
of the private scrapbook. There is a test named after that.

## Who can see it

Nobody, without a password. The gallery was built world-readable, on the assumption it
would be sent to grandparents as a link; it is not, so `gallery_artworks` and
`gallery_config` are `@request.auth.id != ""` like the scrapbook's collections, and the
people who should see it get accounts — which is what viewer accounts already exist for.

**The sign-in is shared with the scrapbook.** `js/session.js` reads and writes the same
`localStorage` key, in the same shape, so one password gets you both apps. That file is
the only place the two apps touch anything of each other's, and it says so loudly: the
key and the shape are a contract with `scrapbook/js/pb.js`.

Two consequences that are not obvious:

- **A private collection does not mean private files.** A PocketBase file field is only
  token-guarded when it is declared `protected`, and neither app declares one — so the
  bytes are reachable by URL without signing in, verified against production. This once
  carried a short-lived file token on every image URL, on the opposite assumption. That
  was worse than redundant: `cache.pb.js` serves `/api/files/` as `immutable` for a
  year, and a token in the query string is a fresh cache key on every page load, so a
  drawing that should be fetched once ever was fetched every time. The trade being
  accepted is that a URL is a capability — it holds two random ids and is not guessable,
  and it is the same bargain the scrapbook makes with the family's photographs.
- **`[hidden]` needs `!important`.** The attribute only sets `display: none` from the UA
  stylesheet, so any author display rule beats it — `.stage` is `display: grid`, and
  hiding it to show the gate did nothing at all. The rule is in `base.css`.

## Whose drawing is whose

`author` is stamped at save time and `updateRule`/`deleteRule` are `author =
@request.auth.id`, the same boundary the scrapbook draws: whoever added a thing can
remove it, nobody else can remove it out from under them.

**Deleting lives in the studio, not on the wall.** The wall is a wall — a frame, a
placard, two arrows, and nothing that exists for only one person. `admin.html` grows a
"Hung so far" list instead, which also makes removing something a deliberate trip to
another page rather than a button next to what you are looking at.

## The bytes on the wire

The stored copy is **WebP at 0.85**, 2000px on its long edge, falling back to JPEG where
a browser cannot encode WebP — and that fallback is measured, not assumed, because
`canvas.toBlob` silently returns a PNG when asked for a type it cannot produce, which for
a photograph is larger than the JPEG it replaced.

Measured on three real drawings: JPEG/0.92 gave 361, 422 and 505 KB; JPEG/0.85 gave 272,
331 and 325; WebP/0.85 gave 153, 187 and 174. About a third of the bytes, with no visible
difference on a flat wash of paint — which is where lossy compression shows first, and
these are mostly flat washes of paint.

The **original** is stored untouched and is never served to the wall, so it costs disk
rather than bandwidth. That is the whole point of keeping it.

## Where the collection lives

PocketBase, as of the flip in `js/data.js`. Writing is gated on `canPost`, the flag on
`users` that the scrapbook's viewer accounts added.

`data-static.js` and `data/artworks.json` are still here and still work — they are the
no-backend mode, for working on the wall or the frames without running a server, the
same job `scrapbook/data/mock.json` does. **The five drawings in that manifest are
placeholders with invented labels.** Nothing seeds them into PocketBase, deliberately:
this is a real gallery and "The Long Cat" is not a drawing Finn made.

Two traps worth knowing, both already sprung once:

- **A PocketBase number field reads back as 0 when it was never set.** The first drawing
  uploaded through the studio came back with `ageYears: 0`, because the birth date could
  not be read and nothing was stored — and "Finn, age 0" is plausible enough to ship.
  `data-pb.js` reads a zero as "not known", and the studio shows the age it is about to
  stamp so a silent failure is visible while it can still be fixed. The field is
  `ageMonths` now, which makes the ambiguity easier to live with: nobody under a month
  old makes a drawing, so a zero can only mean the age was never worked out.
- **The collection can be empty.** The static manifest always had five drawings in it,
  so nothing ever exercised the zero case; PocketBase starts with none. `app.js` has an
  empty state, and it is worth keeping it working.

## The label that writes itself

`deploy/pb_hooks/gallery-describe.pb.js` takes the picture and whatever was typed, asks
Claude for a wall label, and hands the words back. It does not save anything: the text
lands in the note field for a person to read, and the ordinary save path stores it if
they keep it. A model should not be able to put words on a permanent label without
somebody having looked at them first.

The key is `ANTHROPIC_API_KEY` in Render's dashboard, deliberately not in `render.yaml`,
which is committed. `ANTHROPIC_MODEL` overrides the model without a deploy.

**The prompt forbids inventing what the artist said or meant, and that is not a stylistic
preference.** The artist is a baby. He has said nothing about any of this, so a label
that quotes him is a fabricated quotation from a real child, hung on a wall and kept.
The parody only works while every fact on the label is true. The placeholder notes in
`data/artworks.json` do exactly the wrong thing here — they invent quotations — which is
one more reason they are not seeded.

`noteSource` records `generated` only when the words are the model's own and untouched;
edit them at all and it is `human` again.

## Later

`js/data-pb.js` ships now, minimal and unreachable, because a switchboard with one
branch is a lie and the seam only stays honest if both sides exist. Switching over is
flipping `SOURCE` in `js/data.js` and writing the migrations; nothing above the data
layer should have to move. If something does, that is the bug.
