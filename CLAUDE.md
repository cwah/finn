# CLAUDE.md

## Project: Baby Scrapbook

A private, mobile-web-first scrapbook for **two parents** to capture and view their
baby's milestones in a distraction-free space. The defining feature is an **automated
design engine**: parents never configure layout — they just attach content, and the
app instantly formats it (quote cards, portrait/landscape photos, multi-photo grids,
milestone highlights) on the fly.

This is a personal app for an audience of two. Optimize for calm, single-handed mobile
use and battery-friendly performance over feature breadth.

## Core principles

- **Mobile-web first.** Designed for mobile browsers, single-handed use. Desktop is not a target.
- **Zero layout decisions for the user.** The engine infers layout from content. There is no manual layout picker.
- **Lightweight by design.** No client-side frameworks. Semantic HTML5, vanilla JS (ES modules), modern CSS Grid.
- **No build step.** Pure static files served as-is. Open `index.html` and it runs.
- **Battery-conscious animation.** Hardware-accelerated only: `translate3d`, `requestAnimationFrame`, `IntersectionObserver`. No layout-thrashing scroll handlers.

## Tech stack

| Layer        | Choice                                                                 |
|--------------|------------------------------------------------------------------------|
| Frontend     | Semantic HTML5 + vanilla JS (ES modules) + CSS Grid. **No framework, no build.** |
| Timeline     | Infinite scroll via native `IntersectionObserver`                      |
| Animation    | `translate3d` CSS variables + `requestAnimationFrame` (parallax)       |
| Backend      | **PocketBase** (single-file Go binary: SQLite + auth + file storage + REST) |
| Auth         | Individual accounts — one per parent (attribution per post)            |
| Photo storage| **Dev:** local filesystem. **Prod:** cloud object bucket (S3 / R2) via optimization pipeline |

## Build phases

**Phase 1 — Frontend-first (done).** Full UI against a static local `data/mock.json`.
Still selectable: `SOURCE = 'mock'` in `js/data.js` runs the whole app with no backend.

**Phase 2 — PocketBase (current).** Collections mirroring the JSON contract, auth (one
account per parent) and photo upload to the local filesystem. Schema lives in
`pb_migrations/` and is applied on startup, so it is version-controlled rather than
clicked together in the admin UI. See `README.md` to run it.

**Phase 3 — Production.** Photo optimization/compression pipeline + cloud bucket storage.
Deploy.

### The data layer

`js/data.js` is a switchboard between two interchangeable modules, both exporting the
same five functions — `requireSession`, `signIn`, `signOut`, `getConfig`, `getPosts`,
`createPost`:

- `data-mock.js` — static JSON, no accounts.
- `data-pb.js` — PocketBase. **The only module that knows what a PocketBase record looks
  like.** It translates records into the JSON contract below; nothing backend-specific
  escapes it. `pb.js` underneath is a hand-rolled REST client (no SDK — no bundler, no
  dependencies).

Keep the two in step. Everything above them — engine, renderer, timeline, capture, auth
UI — consumes the contract and must stay backend-agnostic.

> **Keep the frontend backend-agnostic.** It consumes the JSON contract below and nothing
> else. Phase 1 and Phase 2 differ only in the data-fetch layer.

Feature requests and ideas live in `BACKLOG.md` — candidates, not commitments. The phases
above are the plan; check the backlog when picking up something new.

## Data model / JSON contract

The frontend reads an array of **posts**, newest memory first. Each post:

```jsonc
{
  "id": "string",
  "memoryDate": "2026-05-01",        // date the moment happened — drives timeline ordering (NOT upload time)
  "createdAt": "2026-05-02T14:30:00Z",
  "author": { "id": "string", "name": "string" },  // which parent uploaded it
  "caption": "string | null",         // optional text; if present with no photos => quote card
  "milestone": {                      // null for ordinary posts
    "isMilestone": true,
    "title": "First steps"
  },
  "photos": [
    {
      "id": "string",
      "url": "string",
      "width": 1200,                  // intrinsic dimensions — engine uses these to pick layout WITHOUT loading the image
      "height": 1600,
      "alt": "string | null"
    }
  ]
}
```

Alongside the posts the data source supplies a `config`:

```jsonc
{
  "babyName": "string",
  "birthDate": "2026-01-15",
  "currentAuthor": { "id": "string", "name": "string" }  // Phase 2: the signed-in parent
}
```

Baby **age stamp** (e.g. "4 months, 2 days") is *computed client-side* from a single
configured `birthDate` and the post's `memoryDate` — it is not stored per post.

## Layout engine

`layout-engine.js` is a pure function: `post -> layoutType`. It infers layout from content
with **no user input and no override**. Rules, in order:

1. **No photos + has caption** → `quote` card (typographic treatment).
   No photos *and* no caption → `null`; there is nothing to show, so `render.js` returns
   no card and the timeline skips the post rather than emitting an empty one.
2. **1 photo, height > width** → `portrait` (tall) card.
3. **1 photo, width >= height** → `landscape` (wide) card.
4. **2–4 photos** (`GRID_MAX`) → `grid` (CSS Grid, count-aware). The first photo leads:
   it fills the wide cell in a three-photo grid.
5. **More than 4 photos** → `carousel`. A five-cell grid has no arrangement that reads
   well, and shrinking each photo further defeats the point of taking them.
6. **Any post with `milestone.isMilestone`** → wrap the above in the `highlight` treatment.

Orientation is decided from stored `width`/`height`, never by loading the image. Keep this
function pure and unit-testable — it's the heart of the product.

`preview.html` is the visual bench: it renders one sample per rule through the real
engine and the real stylesheets. Add a sample there whenever you add a layout type.

### Photos

**Cropping is framing, never destruction.** Cards crop to keep the timeline calm, but
the stored file is always the untouched original. Each photo carries a focal point
(`focalX`/`focalY`, 0–1) that the renderer feeds to `object-position`, so a cover crop
keeps the subject. A missing focal point means dead centre — which is exactly how photos
were cropped before the feature existed, so old records need no migration.

- `smart-crop.js` picks the focal point at capture from the image's own content: local
  contrast, energy-weighted centroid, with a pull toward the middle and a clamp away from
  the edges so noise cannot yank the framing. `focalFromLuma()` is pure and tested; the
  canvas wrapper around it is not. Any failure degrades to dead centre, never an error.
- `photo-editor.js` is the correction when the guess is wrong — drag the focal point,
  previewed in a **square**, because the square grid cell is the crop that actually bites.
- The **first photo leads** a post. "Make main photo" in the editor is a reorder, so the
  choice travels as plain photo order — the renderer, the contract and the backend all
  already treat position 0 as the lead.
- `lightbox.js` opens any photo full-size at its true aspect ratio — `contain`, never
  `cover`. It builds its own markup so there is no second copy in `index.html` to drift,
  and the preview bench gets it for free.
- Carousels scroll with native CSS scroll-snap; `carousel.js` only lights the right dot,
  via an observer rooted on the track rather than a scroll listener.

### Milestone sketch

A milestone is rendered as a **scene**: the card, plus a decorative sketch out on the
page background *beside* it. The card clips its own contents (`overflow: hidden` keeps
photos inside the rounded corners), so the drawing cannot live inside the card and still
appear outside its edges — hence the wrapper.

`renderPost` therefore returns *the element the timeline mounts*, which is the card for
an ordinary post and the scene for a milestone. That element carries `memoryDate` and
the `.timeline-item` reveal class — keep those on the returned element, not on `.card`,
or the scrubber and the reveal animation will miss milestones.

**Placement.** Sketches sit to one side of the card, **alternating** down the timeline.
Milestones are interleaved with ordinary cards, so no CSS selector can count them —
`app.js` assigns `side-left` / `side-right` after mounting, when the order is known, and
re-runs it when a backdated milestone lands mid-timeline and flips every side below it.
Below 880px there is no room beside the card, so the sketch is hidden outright; it is a
wide-screen grace note, not something the phone layout depends on.

**Motion.** Sketches never move. They fade in as their card reaches the middle of the
viewport and fade out as it leaves, driven by an `IntersectionObserver` toggling a class
— opacity only, nothing per frame, no scroll-driven positioning.

**The drawings** come from `milestone-art.js`:

- `ART_PRESETS` is a fixed set: balloons, cake, blocks (stock A/B/C in a triangle),
  donuts, dinosaur, lemons.
- `artPreset(title)` hashes the title to pick one. The title decides *which* stock
  drawing appears, never *what it says* — no parent-typed text ever reaches a drawing.
- `milestoneArtSvg(preset)` returns the markup. Both are pure and unit-tested.

Every stroke is `currentColor`, so `.milestone-art` in CSS is the only thing deciding
hue and the sketches can never drift from the palette.

> **These SVGs are placeholders for PNGs.** The preset name is the contract and is
> already stamped on the wrapper as `data-art`, so swapping in `<img src="art/${preset}.png">`
> touches only how `render.js` builds that node — not the CSS, the sides, or the fade.

The chip keeps the one 12px offset it has on every card, so nothing about the sketch
moves it.

## Suggested structure

```
/index.html              # app shell + sticky bottom nav tray + compose sheet
/preview.html            # visual bench: every layout rendered by the live engine
/css/                    # CSS Grid layouts, one concern per file
  base.css               # palette tokens, shell, header, bottom tray
  cards.css              # the four card layouts + milestone treatment
  compose.css            # the compose sheet
  scrubber.css           # right-edge date scrubber
  auth.css               # sign-in gate
/js/
  app.js                 # bootstrap, routing, infinite-scroll controller
  data.js                # switchboard: picks the data source
  data-mock.js           # Phase 1 source — static mock.json
  data-pb.js             # Phase 2 source — PocketBase records -> the contract
  pb.js                  # minimal PocketBase REST client (auth, list, create)
  auth.js                # sign-in gate
  layout-engine.js       # pure post -> layoutType (the core engine)
  render.js              # build DOM for each layout type
  age.js                 # birthDate + memoryDate -> age stamp
  milestone-art.js       # pure title -> hand-drawn SVG sketch
  smart-crop.js          # pure luma -> focal point, + canvas wrapper
  photo-editor.js        # drag the focal point / promote a photo to lead
  lightbox.js            # full-size viewer (owns its own markup)
  carousel.js            # active-dot tracking for 5+ photo posts
  capture.js             # capture + compose flow
  scrubber.js            # right-edge date scrubber
/data/mock.json          # Phase 1 sample data (matches contract above)
/test/                   # node:test specs for the pure modules
```

## Running it

Both pages need to be served over HTTP — ES modules and `fetch` don't work from
`file://`. There is still no build step:

```
python3 -m http.server 8765     # then open /index.html or /preview.html
npm test                        # node:test specs for layout-engine.js and age.js
```

`package.json` exists only so node treats the `.js` files as ES modules when running
tests. It has no dependencies and nothing bundles.

## Mobile / UX conventions

- **A single floating `+`** at the bottom is the only way in (thumb-reachable). It has no
  bar behind it — the tray is just a positioning strip with `pointer-events: none`, so it
  cannot swallow taps meant for the timeline.
- `+` opens the **compose sheet**: caption, the date the moment actually happened, an
  optional milestone, and an *Add photos* control. It holds no layout controls, by design.
- Photos are optional content inside that one flow, not a second door. Attach some and
  the engine makes a photo card; attach none and a caption becomes a quote card. Adding
  photos uses native camera hardware:
  `<input type="file" accept="image/*" capture="environment">`, and appends to what is
  already pending rather than starting over.
- `memoryDate` is authored, not inferred from upload time, so a new memory can be
  backdated — the timeline inserts it in date order rather than always at the top.
- A **date scrubber** rides the right edge (Google Photos style): month ticks you can
  drag to fly through the timeline, with a bubble showing where you are. It fades in
  while scrolling and idles out of sight so it never covers a memory. It is
  `aria-hidden` — a shortcut for scrolling, not a second copy of the timeline.

## Colour

The palette is **sage green and baby blue**, light and pastel, defined once as tokens in
`base.css`. **Sage leads** — page, surfaces, milestone ring, milestone sketch, quote
glyph, focus rings, scrubber ticks. Baby blue is the deliberate secondary, kept to small
pops: the milestone chip, the scrubber thumb and bubble, and the second stop of the
capture/save gradients. Keep that balance when adding colour.

- Cards are near-white on a pale sage page, so they separate by **shadow, not contrast** —
  `--shadow-card`. Shadows are tinted with the text sage rather than black.
- `--accent` is pastel and only for fills. Anything that must be **read** — the quote
  glyph, focus rings — uses `--accent-ink`; the pastel sage is only 2.2:1 on a light card.
  `--blue` / `--blue-ink` split the same way.
- `--bg-rgb` and `--blue-rgb` exist as channels so translucent fills and gradient washes
  tint with the same colour at any alpha. Gradients that fade out should name the same
  colour at alpha 0 rather than `transparent`, which interpolates through transparent
  black and greys the middle of the fade.
- Check contrast when changing these: body text and the small date/author text both need
  to clear WCAG AA (4.5:1) on `--surface`, `--surface-2` and `--bg`.
- Target single-handed operation; keep tap targets large and actions reachable from the bottom.

## Performance rules

- Timeline paging is driven by `IntersectionObserver` sentinels, never scroll-event listeners.
- Animate only `transform` (`translate3d`) and `opacity`. Never animate layout properties.
- Batch DOM reads/writes; do positional work inside `requestAnimationFrame`.
- Lazy-load images (`loading="lazy"`); rely on stored dimensions to reserve space and avoid reflow.

## Conventions

- Vanilla ES modules, no bundler. Reference files relatively.
- Keep `layout-engine.js` and `age.js` pure (no DOM, no fetch) so they stay testable.
- When adding a layout type: update the engine rules above, `render.js`, and the CSS together.
