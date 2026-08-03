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

**Phase 1 — Frontend-first (current).** Build the full UI against a static local
`data/mock.json` file matching the contract below. No backend yet. This is the fastest
path to a working app on a phone.

**Phase 2 — PocketBase.** Stand up PocketBase, define collections mirroring the JSON
contract, wire auth (two accounts) and photo upload (local filesystem). Frontend swaps
its data source from `mock.json` to the PocketBase REST API — the JSON shape stays the same.

**Phase 3 — Production.** Photo optimization/compression pipeline + cloud bucket storage.
Deploy.

> **Keep the frontend backend-agnostic.** It consumes the JSON contract below and nothing
> else. Phase 1 and Phase 2 differ only in the data-fetch layer.

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
4. **2–4 photos** → `grid` (CSS Grid, count-aware).
5. **Any post with `milestone.isMilestone`** → wrap the above in the `highlight` treatment.

Orientation is decided from stored `width`/`height`, never by loading the image. Keep this
function pure and unit-testable — it's the heart of the product.

`preview.html` is the visual bench: it renders one sample per rule through the real
engine and the real stylesheets. Add a sample there whenever you add a layout type.

### Milestone header band

Every milestone card opens with a header band carrying a hand-drawn sketch, generated
by `milestone-art.js` — another pure function, `title -> SVG markup`, chosen from the
title alone with no user input:

- **≤ 6 letters** → baby blocks, one letter per block, spelling the title out.
- **anything else** → balloons.

The sketch is monochrome: every stroke is `currentColor`, so `.milestone-art` in CSS is
the only thing that decides its hue and it can never drift from the palette. The wobble
that makes the lines look hand-drawn is seeded from position, never random, so a given
milestone always draws the identical sketch. The title is stripped to `[A-Z]` before it
reaches any `<text>`, which is what makes generating the markup as a string safe.

The band is reserved with `padding-top` rather than overlaid, so it behaves the same
whether the card below it is a photo, a grid or a quote — and the chip keeps the one
12px offset it has on every card.

## Suggested structure

```
/index.html              # app shell + sticky bottom nav tray + compose sheet
/preview.html            # visual bench: every layout rendered by the live engine
/css/                    # CSS Grid layouts, one concern per file
  base.css               # palette tokens, shell, header, bottom tray
  cards.css              # the four card layouts + milestone treatment
  compose.css            # the compose sheet
  scrubber.css           # right-edge date scrubber
/js/
  app.js                 # bootstrap, routing, infinite-scroll controller
  data.js                # data source (Phase 1: fetch mock.json; Phase 2: PocketBase)
  layout-engine.js       # pure post -> layoutType (the core engine)
  render.js              # build DOM for each layout type
  age.js                 # birthDate + memoryDate -> age stamp
  milestone-art.js       # pure title -> hand-drawn SVG sketch
  capture.js             # bottom-nav capture + compose flow
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

- **Sticky bottom navigation tray** is the primary nav surface (thumb-reachable). It
  carries two actions: capture a photo, and write a text-only memory (which the engine
  turns into a quote card).
- Capture uses native camera hardware: `<input type="file" accept="image/*" capture="environment">`.
- Both actions land in the same **compose sheet** — caption, the date the moment actually
  happened, and an optional milestone. It holds no layout controls, by design.
- `memoryDate` is authored, not inferred from upload time, so a new memory can be
  backdated — the timeline inserts it in date order rather than always at the top.
- A **date scrubber** rides the right edge (Google Photos style): month ticks you can
  drag to fly through the timeline, with a bubble showing where you are. It fades in
  while scrolling and idles out of sight so it never covers a memory. It is
  `aria-hidden` — a shortcut for scrolling, not a second copy of the timeline.

## Colour

The palette is **sage green and baby blue**, light and pastel, defined once as tokens in
`base.css`. Sage carries the app; baby blue carries the milestone treatment (ring, chip,
band wash, sketch, scrubber thumb).

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
