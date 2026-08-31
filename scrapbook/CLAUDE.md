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

**Phase 3 — Production (current).** Set up to deploy to Render as ONE Docker service:
PocketBase serves the API and the frontend together, with a persistent disk at
`/pb/pb_data` holding the database and every uploaded file. The configuration is in the
repo and the image has not been built yet — see `../deploy/DEPLOY.md`.

- **One service, one origin.** Serving the frontend from `pb_public` means no CORS, no
  second deploy to keep in step, and no API URL to configure. The frontend is *not*
  restructured into `pb_public` in the repo — it stays at the root so `serve.py` keeps
  working, and `../deploy/Dockerfile` does the copying. The scrapbook is served at
  the root of `pb_public`; Finn's art gallery is a sibling app under `/gallery/`.
- **The disk mounts over `pb_data`**, so `pb_migrations` lives beside it rather than
  inside: schema is source and travels with the image, while data persists across deploys.
  A container filesystem is thrown away on every deploy, and so are the memories.
- **The PocketBase version is pinned and its checksum verified at build time.** A rebuild
  must not quietly change the backend under a scrapbook that is already full.
- Still outstanding for this phase: the photo optimisation/compression pipeline and cloud
  bucket storage. Both are in `BACKLOG.md`; the deploy works without them.

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

`updatePost` **diffs** photos rather than replacing them: a draft photo carrying an `id`
was already stored, so only its order and framing are patched. Re-uploading everything
would re-send files that never changed and churn stored images for nothing.

> **Keep the frontend backend-agnostic.** It consumes the JSON contract below and nothing
> else. Phase 1 and Phase 2 differ only in the data-fetch layer.

Feature requests and ideas live in `BACKLOG.md` — candidates, not commitments. The phases
above are the plan; check the backlog when picking up something new.

`KNOWN-BUGS.md` is the other list: things that already look built and do not work, with
what is known and — as importantly — what has not been confirmed. Check it before assuming
a report is new, and write down the boundary of what was actually tested.

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
      "url": "string",                // the still — a photo, or a video's poster frame
      "width": 1200,                  // intrinsic dimensions — engine uses these to pick layout WITHOUT loading the image
      "height": 1600,
      "alt": "string | null",
      "rotation": 0,                  // 0|90|180|270 clockwise, applied at render
      "video": {                      // null for a plain photo
        "url": "string",
        "duration": 184.2,            // of the SOURCE file, seconds
        "trimStart": 12.5,            // the stretch that plays; the file keeps every frame
        "trimEnd": 48.0,
        "motion": true                // a motion photo loops on screen; a video waits
      }
    }
  ]
}
```

An item in `photos` is **a picture, which may also move**. A video's poster IS a photo —
literally so for a motion photo, and by construction for a video, whose poster is grabbed
from its own frames at upload. That is why video did not need a second collection or a
second array: the engine, the crop box and every layout rule go on reasoning about
`width`/`height` and never learn that motion exists.

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

Orientation is decided from stored `width`/`height` **after rotation and cropping** —
`croppedSize()`, never the raw dimensions — and never by loading the image. Keep this
function pure and unit-testable — it's the heart of the product.

`preview.html` is the visual bench: it renders one sample per rule through the real
engine and the real stylesheets. Add a sample there whenever you add a layout type.

### Photos

**Cropping is framing, never destruction.** The stored file is always the untouched
original. Two settings shape how a photo appears, and both are stored, never baked in:

- **`crop`** — the rectangle the parent chose, `{x, y, w, h}` normalised 0–1. Applied at
  render, so it can be widened, moved or removed forever.
- **`focalX`/`focalY`** — what to keep centred in the *cropped* result when a card's cell
  is a different shape again. The crop picks the picture; the focal point survives the
  second crop a square grid cell imposes on top of it. Both earn their place.

`coverAlign()` turns a focal point into the anchor a cell is positioned by, and the
distinction matters. Anchoring at the focal fraction directly — what `object-position`
does — merely *aligns*: a focal point of 0.15 sits 15% across the cell, not in the middle
of it. `coverAlign` instead solves for the anchor that puts the focal point at the cell's
centre, `p = (0.5 - fk) / (1 - k)` where `k` is how many times bigger the photo is than
the cell on that axis, clamped to 0–1. That clamp *is* the no-empty-space rule, so a
focal point near an edge settles as close to centre as covering permits and no closer.

`croppedSize()` is what the layout may reason about — **never the raw width/height**.
Cropping a wide photo into a tall frame really does make it a portrait card, and a
carousel takes its shape from what photos were cropped to. A card contradicting the
picture a parent framed would be worse than no cropping at all.

Rendering uses a **crop box**: `object-fit` cannot express an arbitrary rectangle, so the
image is oversized inside an overflow box and offset until the chosen region fills it.
Every photo gets the wrapper — an uncropped one is cropped to all of itself — so there is
one code path rather than two that could disagree.

A missing focal point or crop means dead centre / the whole photo, which is exactly how
photos behaved before either existed.

- `smart-crop.js` picks the focal point at capture from the image's own content: local
  contrast, energy-weighted centroid, with a pull toward the middle and a clamp away from
  the edges so noise cannot yank the framing. `focalFromLuma()` is pure and tested; the
  canvas wrapper around it is not. Any failure degrades to dead centre, never an error.
- `photo-editor.js` is where both are set, on **one surface** showing the whole photo:
  drag a corner to resize the crop, drag elsewhere to move it, and **tap to set the focal
  point**. A tap is told from a drag by whether the pointer travelled, which lets the two
  gestures share the surface without asking the parent to choose a mode first.
  The focal point is held in *photo* space while editing, so it stays on the subject as
  the crop moves around it, and is converted to crop space on save.
- The **first photo leads** a post. "Make main photo" in the editor is a reorder, so the
  choice travels as plain photo order — the renderer, the contract and the backend all
  already treat position 0 as the lead.
- `lightbox.js` opens **the cropped picture**, never the file it was cropped from —
  expanding a photo must not reveal what a parent deliberately cut away. It is fitted to
  the screen by default; tapping zooms to the **crop's** natural pixels (a 400×900 crop
  of a 1600×900 file zooms to 400×900) and the stage becomes a pannable window. Zoom is
  only offered when the crop is genuinely being shown smaller than it is.
  - Its sizes are computed in JS, not CSS: `max-width`/`max-height` cannot fit a box
    whose contents are positioned by crop maths, and both numbers needed — the crop's
    pixel size and the room available — are known there. It runs on open, page, zoom and
    resize; never per frame.
  - It builds its own markup, so there is no second copy in `index.html` to drift, and
    the preview bench gets it for free.
  - The stage is **flex, not grid**. A percentage `max-height` on a grid item resolves
    against its grid *area*, which is auto-sized by the item — circular, so the cap is
    silently ignored and tall photos overflow the screen. Flex with a definite height
    gives the image something real to measure against.
  - Only the stage scrolls; the controls and counter are `position: fixed` so nothing
    shifts with the photo's shape or while panning.
- Carousels scroll with native CSS scroll-snap; `carousel.js` only lights the right dot,
  via an observer rooted on the track rather than a scroll listener.
- **The lead photo sets the card's shape**, via `leadAspect()` in the engine. It governs
  the two places where one photo decides a shape: the full-width hero cell of a
  three-photo grid, and every slide of a carousel. (Two- and four-photo grids are square
  by design and ignore it, as does a single-photo card, which takes its photo's shape
  directly.)
  - Every carousel slide must share a shape or the card's height jumps mid-swipe, so the
    others are cropped to the lead's. That is the cost of making **cropping and "make
    main photo" mean what they say** — both are the parent's to control, and a card that
    ignored a crop would be contradicting them.
  - Clamped only against the absurd, 1:3 to 3:1. Anything tighter would refuse a crop the
    same photo could have as a single-photo card, which is the complaint `leadAspect`
    exists to answer.
- A card's bottom padding comes from its caption. Cards without one give it to the meta
  row instead; watch for that if you add another trailing element.

### Video and motion photos

Video is not a second kind of post. **A video's poster frame IS its photo**, so a clip
travels through the same `photos` array, the same crop box and the same layout rules as a
still. `photoEl()` in `render.js` is the only place that knows the difference.

- **Trimming is framing, never destruction** — the same rule as cropping. The stored file
  keeps every frame; `trimStart`/`trimEnd` say which stretch the memory is, so a trim can
  be widened, moved or removed forever. `trimRange()` is pure and tested, and always
  returns a valid window: a missing or nonsensical trim degrades to the opening minute
  rather than to an error.
- **Nothing plays for longer than `MAX_CLIP_SECONDS` (60).** The cap is applied in
  `trimRange`, not in the UI, so no stored value can out-argue it. A longer source is
  *accepted* — the editor opens on its first minute and the parent picks which minute
  matters, rather than being sent back to their phone to cut it first.
- **A motion photo can be stopped.** It loops by itself, so its badge is a *pause* rather
  than a play — hidden until the photo is pointed at, because a control parked permanently
  on a photo is its own kind of noise. Once it is holding the loop still it **stays
  visible**: a paused motion photo with no visible control does not read as paused, it
  reads as broken. On touch, where there is no hover, it simply lives there at low opacity
  — that is the only way to reach it at all.
- A manual pause is held in `heldStill` and deliberately **outlasts scrolling**. The
  observer would otherwise restart the loop the moment the card came back into view, and
  the button would look like it had failed. `playing` is only about what is on screen;
  the two are separate on purpose.
- **Motion photos loop; videos wait.** A motion photo IS its motion, and one that never
  moved would just be a photo. A longer clip waits for a tap, because several decoders at
  once is exactly the battery cost this app avoids everywhere else. `motion-play.js`
  drives it from an `IntersectionObserver`, gives up playback entirely while the tab is
  hidden, and never autoplays for someone who asked for `prefers-reduced-motion`.
- `isMotion` is **stored, not derived from duration**: it says what the file IS, and
  trimming a video down to two seconds must not silently turn it into wallpaper.
- **The badge is the play button.** A video still never starts by itself, but expanding it
  to watch four seconds was too much ceremony, so tapping the badge plays the clip in
  place; tapping the picture around it still expands. Both gestures stay available, and
  nothing autoplays. The badge is a sibling of the crop box, never a child: the box is
  deliberately oversized and offset to show its crop, so anything inside it would be
  positioned against the picture rather than against the cell.
- `holdToTrim()` lives in `motion-play.js` and is shared with the lightbox, so a trim means
  the same thing whether a clip is played in place or expanded.
- The lightbox never offers zoom on a video. Its taps belong to its own controls.

**Motion photos arrive in two shapes and neither announces itself** — `motion.js` is pure
over file descriptors and bytes, so both are testable without a phone:

- **Apple** shares a Live Photo as *two* files, `IMG_1234.HEIC` and `IMG_1234.MOV`.
  Nothing but the matching name ties them together, so the name is the relationship.
  `pairLivePhotos()` matches them in picker order; a still with no movie, or a movie with
  no still, passes through alone.
- **Google** appends the mp4 *inside* the jpeg. `findEmbeddedVideo()` scans for the `ftyp`
  box signature rather than parsing XMP, because the metadata is written differently by
  different Android versions and is missing on some files that still carry a video. A box
  whose length runs past the end of the file is rejected, so the same four letters
  occurring inside image data cannot split a photo in half.

### Rotation

Rotation is framing too, so it is stored and applied at render — the file is never
re-encoded, and turning a photo the wrong way costs nothing to undo.

- **It changes the card.** `orientedSize()` swaps the axes on a quarter turn and
  `croppedSize()` is built on it, so a sideways landscape really does become a portrait
  card. Anything reasoning about shape gets this for free.
- **Rotation is applied FIRST, then the crop.** The crop rectangle is expressed against
  the *upright* photo — the one the parent was looking at when they dragged it — so
  turning a photo later cannot re-frame the picture they chose.
- Because of that order, the editor has to **carry the crop and focal point round with
  the photo** when it turns. `turnFraming()` does it, is pure, and is tested: four
  quarter turns must land exactly where they started, which is why it rounds. `1 - y - h`
  drifts a little every turn, and these values are stored and turned again later.
- **The rotor** is how it renders. A CSS transform never changes a layout box, so
  rotating the media alone would leave the crop maths measuring the shape it used to be.
  The rotor is the layout box instead: it takes the oriented aspect ratio — exactly what
  the media's intrinsic ratio used to supply — and the media is turned inside it. Cards,
  the lightbox and the editor all build the same rotor, so a photo is framed on exactly
  what a card will show.
- Every photo gets a rotor, turned or not — one code path rather than two that could
  disagree, the same reason every photo gets a crop box.

### Milestone sketch

A milestone is rendered as a **scene**: the card, plus a decorative sketch out on the
page background *beside* it. The card clips its own contents (`overflow: hidden` keeps
photos inside the rounded corners), so the drawing cannot live inside the card and still
appear outside its edges — hence the wrapper.

`renderPost` therefore returns *the element the timeline mounts*, which is the card for
an ordinary post and the scene for a milestone. That element carries `memoryDate` and
the `.timeline-item` reveal class — keep those on the returned element, not on `.card`,
or the scrubber and the reveal animation will miss milestones.

**Placement.** Artwork is **fixed to the viewport**, not to the card: it holds one spot on
screen while the card scrolls past it, and only its opacity changes. Sides **alternate**
down the timeline, which also keeps two simultaneously-visible milestones from stacking
on top of each other.

> A transformed ancestor becomes the containing block for a `fixed` descendant, which
> would trap the artwork inside the scene and make it scroll after all. That is why the
> reveal animation's `transform` lives on `.card` rather than on `.timeline-item`. Keep it
> there. Opacity is fine — it makes a stacking context, not a containing block.

**A piece of artwork may pin itself to one side** with `side` in its `ART_IMAGES` entry —
`dinosaur` is pinned right. Art is not symmetric, and a drawing that leans one way looks
wrong flipped to the other edge. `assignSides()` gives pinned pieces the side they asked
for and alternates everything else *around* them, rather than following a fixed stripe.

Free artwork looks **both ways** — at what came before it and at the next pinned piece.
Backwards alone is not enough: a pin cannot move, so the free piece before it has to.
Alternation fixes a whole run of free artwork from its first side, so that first side is
the only real choice, and it is made by looking at the pin the run has to reach.

Pin sparingly. Two pinned neighbours share a side, and so does a free run of the wrong
length between two pins — with only one side pinned in the set, an *even* number of free
pieces between two dinosaurs cannot clear both ends. The test brute-forces the best any
arrangement could do and holds `assignSides` to it, so a clash that remains is forced
rather than sloppy. Fixed artwork on the same side overlaps when both are on screen.

Milestones are interleaved with ordinary cards, so no CSS selector can count them —
`app.js` applies the result after mounting, when the order is known, and re-runs it when a
backdated milestone lands mid-timeline and shifts every side below it.
Below 1024px there is no room beside the card, so the artwork is hidden outright; it is a
wide-screen grace note, not something the phone layout depends on. At 400px wide it needs
more room than the earlier 200px did — below that breakpoint its outer edge would be cut
off by the viewport, which reads as broken rather than as bleeding.

**Motion.** Artwork never moves — the fade *is* the animation. `centreProgress()` in
`fade.js` (pure, tested) maps a card's position to 0–1: fading up as it comes into view,
clearest when the card owns the screen, fading away as it leaves. `app.js` writes that to
`--art-progress` once per scroll frame, for the handful of cards an observer says are on
screen. Opacity only; nothing is repositioned. The peak is `--art-peak`, deliberately
below 1 — it is a background, not a subject.

**The drawings** come from `milestone-art.js`:

- `ART_PRESETS` is a fixed set: balloons, cake, blocks, donuts, dinosaur — all five with
  real artwork in `assets/`.
- **A birthday gets cake or balloons and nothing else.** Some milestones mean something
  specific, and a birthday drawn as a dinosaur is just wrong. `isBirthday()` is kept
  deliberately tight — "three months old" is a milestone but not a birthday.
- Everything else falls to a hash of the title. The title decides *which* stock drawing
  appears, never *what it says* — no parent-typed text ever reaches a drawing.
- **Nothing repeats on adjacent milestones.** `assignPresets()` takes the whole run in
  timeline order and moves a milestone to its next choice when its first would repeat
  its neighbour's. It matters most for artwork pinned to a side, where two neighbours
  would place their artwork in the same fixed spot and overlap.
- `milestoneArtSvg(preset)` returns the markup. All of these are pure and unit-tested.

> Because the choice depends on neighbours, **inserting a milestone can change what the
> ones around it show**, and `renderPost` cannot bake the drawing in. `app.js` fills it via
> `setMilestoneArt()` in the same pass that assigns sides, and re-runs on every insert,
> edit and delete.

Every stroke is `currentColor`, so `.milestone-art` in CSS is the only thing deciding
hue and the sketches can never drift from the palette.

**Adding artwork:** drop the file in `assets/` and add one line to `ART_IMAGES` in
`milestone-art.js` with its dimensions. A preset without a file falls back to its SVG, so
one can be added before its drawing exists.

- Files are **alpha masks**, not pictures: greyscale-plus-alpha PNGs whose alpha carries
  the drawing, applied with `mask-image` so they take `--accent-ink` and cannot fall out
  of the palette. Convert on the way in — the colour channels are never read, and
  dropping them took the set from 5.95 MB to 0.76 MB.
- The URL must be made absolute in JS. A relative URL inside a custom property resolves
  against the *stylesheet* that uses it — `css/cards.css` — so `assets/…` would be looked
  for under `css/assets/…`.
- Dimensions live in the manifest so the wrapper can take the artwork's shape without
  waiting for the file to load.

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
  motion.js              # PURE: Live Photo pairing + Google embedded-mp4 scan
  motion-play.js         # motion photos loop on screen; videos wait for a tap
  photo-editor.js        # crop, focal point, rotate, trim, promote to lead
  lightbox.js            # full-size viewer (owns its own markup)
  carousel.js            # active-dot tracking for 5+ photo posts
  capture.js             # capture + compose flow
  media-date.js          # PURE: EXIF / filename -> when a photo was taken (shared w/ bot)
  scrubber.js            # right-edge date scrubber
/bot/                    # Telegram bot — a separate node process, never served
  index.js               # polling loop, album debounce, sender auth
  message.js             # PURE: telegram messages -> post draft
  parse-date.js          # PURE: "8/14", "aug 12" -> a day (month first)
  image-size.js          # PURE: jpeg/png header -> dimensions (node has no canvas)
  telegram.js            # Bot API client (long polling)
  pocketbase.js          # PocketBase client for node (no localStorage)
/data/mock.json          # Phase 1 sample data (matches contract above)
/test/                   # node:test specs for the pure modules
```

## Telegram bot

A second door into the same scrapbook. It creates ordinary posts and nothing else — no
new fields, no layout hints. Rules that must hold:

- **Long polling, never webhooks.** A webhook needs a public HTTPS URL; this stack lives
  on localhost. The bot dials out.
- **Attribution survives the bot.** It authenticates as its own PocketBase account but
  sets `author` to the parent mapped by `users.telegramId`. A post made from a phone is
  credited to the person, not the robot.
- **The reply names what was saved** — "a motion photo", "2 photos and a video". It is the
  only signal that a clip arrived as a clip rather than as a still, which is exactly what
  Telegram breaks, so `summarise()` never flattens everything to "photo".
- **Unknown senders are refused**, and told their Telegram id so it can be added by hand.
  Anyone can find a bot by name; this is the only thing standing in front of the data, so
  the mapping IS the allowlist — an account with no `telegramId` cannot post, full stop.
  Refusals are logged with whatever the sender's name and id were, so an attempt to write
  to the scrapbook is visible rather than silent.
- **The bot's own account is refused as an author**, even if a `telegramId` is put on it by
  mistake. Posts would be credited to "Telegram bot" rather than to a parent, and
  attribution surviving the bot is the whole point of mapping senders to people.
- `photos.createRule` is `@request.auth.id != ""` (not author-scoped) precisely because
  the bot writes photos onto another user's post. Update and delete stay author-scoped.
- **No focal point from the bot** — smart-crop measures pixels on a canvas. Absent focal
  means centre, which is what an un-framed photo has always meant.
- **A clip's duration must be READ, never left at 0.** `hasVideo()` gates on
  `trimRange().duration > 0`, so a stored 0 makes a perfectly good clip render as a plain
  still — the split works, the file is stored, and the card shows a photo anyway. node
  cannot decode video, but it does not need to: `mp4Duration()` reads the `mvhd` box,
  which states a timescale and a duration outright. Pure and tested, and cross-checked
  against the browser's own measurement of the same files.
  If the length genuinely cannot be read, the clip is dropped and the still saved on its
  own — an honest photo beats a video that silently cannot play.
- **Video comes through, with Telegram's own thumbnail as the poster.** Node cannot decode
  a frame, and Telegram states a clip's width, height and duration on the message, so
  nothing has to be inferred. A clip sent as a *file* is refused instead: it carries no
  thumbnail, and there is nothing to pose for it.
- **A memory is dated from the media, not from when it was sent.** `memoryDate` is
  authored, never inferred from upload time, and that has to hold whichever door a post
  comes through — a photo taken on Friday and sent on Sunday belongs on Friday. In order
  of who knows best: an explicit `#date`, then the media's own timestamp, then the send
  date. Among several items the **most recent** wins: a set of photos is one memory, and
  it belongs on the day it finished happening. The rule is `dateMemory()` in `message.js`
  rather than inline in the polling loop, because `index.js` starts the bot on import and
  so nothing in it can be tested.
- **The bot and the compose sheet date a multi-day set differently, on purpose.** The bot
  takes the most recent; the app requires unanimity and falls back to today. The asymmetry
  is about who is looking: the app's fallback sits in an editable field in front of a
  parent *before* anything is saved, so an obvious placeholder costs nothing, whereas a
  bot post is already written by the time the reply is read and fixing it means opening
  the app. The closer guess is worth more where the correction is remote — provided it is
  not silent. When the media come from more than one day the reply names the days it saw
  and the one it picked, so a parent can tell a date that was READ from one that was
  CHOSEN.
- **A clock claiming tomorrow discredits the whole set, not just its own photo.** A camera
  wrong by a day is wrong on every photo it took, so falling back to the newest day that
  *isn't* in the future would be trusting siblings of the item that gave the error away.
  The send date is the only thing known at that point.
- `media-date.js` is **shared with the app** and lives in `js/`, not `bot/` — that is the
  direction dependencies already run here: the bot imports from the app, never the other
  way about. The compose sheet dates a new post with the same readers.
- **`mp4CreatedAt` returns a LOCAL day, not a UTC one.** mvhd holds a genuine UTC instant
  — confirmed against a Pixel clip whose Google filename, itself written in UTC, names the
  same day — but every other date here is local, including the send date it gets compared
  against. Read as UTC, a clip filmed at 19:35 on the 10th in Los Angeles came back as the
  11th, which then looked like a camera clock claiming tomorrow and was discarded outright.
  It surfaced as "the date was not inferred", never as a date one day off, which is why it
  needed a real file to see. `test/motion.test.js` pins `TZ` for this reason: from a
  machine running in UTC the two readings agree and the suite proves nothing.
- **Telegram re-encodes VIDEOS as well as photos**, which was assumed otherwise here and
  was wrong. Settled by comparing a delivered clip against the same phone's original:
  brands `isomiso2avc1mp41` against `isomiso2mp41`, and every `com.android.*` tag gone —
  ffmpeg's fingerprints. Its mvhd times the re-encode, not the filming, so a video sent
  the normal way arrives dated the day it was sent, exactly like a photo.
- **A photo or video sent as a photo or video is QUERIED before it is saved.** Not refused — sometimes
  compressed is exactly what someone wants, and a bot that will not save a forwarded
  screenshot is worse than one that asks. The question comes after `#date` has been
  validated and **before a single byte is downloaded**: `countCompressed()` reads the
  draft, so a parent who meant to send files finds out in seconds rather than after
  several megabytes and an unrecoverable post. Two things are deliberately never queried:
  a **GIF**, which was downloaded from somewhere and never had a moment it was taken; and a
  **live photo**, which Telegram carries on its own path, so the only advice a question
  could give is "send it some other way".
  - **The MESSAGES are held, not a draft**, in `awaitingConfirmation` keyed by chat. A
    "yes" replays them through the same code path, so there are not two paths to keep
    agreeing, and `file_id`s stay valid so the media is fetched only once it is wanted.
  - **One question outstanding at a time.** Anything that is not an answer clears it —
    a second send supersedes the first, and an unrelated message drops it — because a
    "yes" an hour later must not save a post someone had moved on from. An hour is also
    the hard ceiling (`CONFIRM_TTL_MS`).
  - **Only a bare yes or no counts.** "yes, that was his first word" is a memory, not an
    answer, and length is the only thing distinguishing them. Media is never an answer.
  - **A confirmed post is not lectured.** The compression note is suppressed once they
    have said yes; `dateMemory`'s line stays, because it reports which date the post got
    rather than how it should have been sent.
  - In memory, so a restart forgets the question. That is the right trade for something
    answered in seconds — a file on disk could outlive the question and save an
    abandoned post days later.
- **`bot/index.js` only starts the bot when RUN, not when imported** (`process.argv[1]`
  against `import.meta.url`), which is what makes `handleGroup` testable at all. The pure
  modules were always well covered and the wiring between them was not, which is the shape
  of every assembly bug this bot has had. `test/bot-confirm.test.js` drives the whole flow
  against stubbed Telegram and PocketBase clients.
- **Bot messages are written as whole paragraphs on one source line**, however far past
  the margin they run. `HELP` joins its array with newlines, so wrapping the source wraps
  the message — a parent read "untick “Compress" and then "images”" on a new line. Telegram
  wraps to the screen it is on, which is the only width actually known.
- **A compressed photo carries no date whatsoever, and this is the common case.** Checked
  against bytes Telegram actually delivered, not assumed: the JPEG has no APP1 segment at
  all — JFIF and an ICC profile and nothing else — the strings `Exif` and `DateTime` do
  not appear, and the filename supplied is `file_23.jpg`. So dating works ONLY on the file
  path, which is the same constraint that governs motion photos and for the same reason:
  Telegram re-encodes anything sent as a "photo". The reply now says so outright, because
  "I dated this today" and "there was no date to read" are indistinguishable from the
  phone — the picker still shows the original, timestamp and all.
- **EXIF outranks the filename**, and not arbitrarily. Google names files in UTC while
  EXIF records local time, so a photo taken at half past ten on a Tuesday evening is
  *named* for Wednesday. Checked against real stored photos: 11 of 13 agreed, and both
  disagreements were the filename being wrong. A compressed photo has neither, which is
  one more thing the file path preserves.
- **`#date` is read before a single byte is fetched.** A date that cannot be understood,
  or that lands in the future, stops the post there rather than after several megabytes
  have crossed the wire. A future date is *asked about*, never guessed at: "12/25" in
  August most likely means last Christmas, and assuming the current year would quietly
  file a memory five months ahead.
- **Relative dates are counted back from today**: "yesterday", "two weeks ago", "last
  friday", "last month". A bare weekday means the most recent one, today included — say
  "friday" on a Friday and you mean today — while "last friday" reaches past it. Month
  arithmetic reuses `addMonthsClamped` from `age.js` rather than growing a second copy of
  a rule that fiddly. A **vague** quantity ("a few weeks ago") is refused, not guessed at:
  it is a real amount to whoever wrote it, and picking three would date a memory wrongly
  with total confidence. Relative dates settle their own year, so the reply does not offer
  to explain that it assumed this one.
- Date parsing is **American convention, month first** — "8/14" is the 14th of August.
  Stated because it is genuinely ambiguous and half the world reads it the other way.
  `parse-date.js` is pure and is handed "today" rather than reading the clock, so the
  awkward cases are testable without waiting for the calendar.
- **`live_photo` must be read BEFORE `photo`.** The Bot API delivers a live/motion photo's
  clip in `Message.live_photo` and *also* fills in `Message.photo` for backward
  compatibility. Checking `photo` first finds it and silently discards the motion — which
  is a bug this codebase actually shipped. Order is the fix; the tests pin it.
- Sending as a FILE also works, and preserves full resolution besides. Sent the normal way,
  Telegram re-encodes it to a plain still and the motion is gone before the bot ever sees
  it — no amount of parsing at this end can recover it. Sent as a file, the original bytes
  arrive intact and `findEmbeddedVideo()` splits out the mp4, exactly as in the browser.
  The help text says so, because the failure is otherwise silent and looks like a bug.
- Which is why **image documents are accepted**, though they carry no dimensions.
  `bot/image-size.js` reads width and height out of the JPEG or PNG header — pure, tested,
  and the only way to measure an image with no canvas. An unreadable format is reported,
  never guessed at, because every layout is chosen from stored dimensions.
- **Telegram will not hand a bot a file over 20 MB**, whoever sent it. A minute of phone
  video is often more than that, so the size is checked before downloading and the sender
  is told plainly rather than left with a failed post.
- `bot/message.js` stays pure, like the engine and the age maths: albums, captions,
  milestone tags and size selection are all testable without a token.
- **Telegram is resolved IPv4-first** (`setDefaultResultOrder`). Long polls failed
  intermittently with a bare "fetch failed" 0.3s in — a connect error, not a timeout —
  because `api.telegram.org` has an AAAA record and this machine's IPv6 default route runs
  into a VPN interface that discards the packets. Measured: IPv4 10/10, IPv6 0/10. Happy
  Eyeballs hid it as flakiness rather than a broken route. No messages are lost when a
  poll fails, since the offset only advances on success, but they are delayed — and a bot
  that spends its time retrying looks like a bot that is broken.
- The polling offset lives in `bot/.offset` (gitignored). Telegram redelivers anything
  unacknowledged, so losing it replays messages.

## Running it

Both pages need to be served over HTTP — ES modules and `fetch` don't work from
`file://`. There is still no build step:

```
python3 serve.py                # then open /index.html or /preview.html
                                # (http.server + no-store; ES modules cache otherwise)
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
- **The same sheet edits.** A pencil on a card reopens it prefilled; a separate edit form
  would be a second authoring surface to keep in step, and every field means the same
  thing either way. Deleting a memory lives at the bottom of that sheet, behind a
  confirm — photos cascade with the post and there is no trash.
- **Logins accept a username or an email address.** `identityFields` is
  `['username', 'email']` and PocketBase tries them in order; the frontend just passes an
  `identity` through and does not care which it is. The username is what anyone will
  actually type — the email is the way back in when it is forgotten, which is why the
  field is labelled for both rather than hiding the fallback from the person who needs it.
- **Migrations that change schema must tolerate the schema already existing.** The
  username field was added by hand in the production admin UI before its migration ever
  ran there, so a migration that assumes it is the only way a column can appear would fail
  on startup — and on a container platform that is a deploy which never comes up.
  `1755300000_username_login.js` checks before each step.

  **Check the SHAPE, not the names this file would have used.** The first attempt looked
  for its own index name, did not find it, added a second index over a column that already
  had one, and Render refused the deploy with *"The index definition already exists"*.
  What is already there was not put there by this file and does not look like it —
  PocketBase names an index it generates itself. The test that passed beforehand was not
  faithful: it simulated the field existing under this file's own index name, which is the
  one case that could never happen in the wild.
- **Viewer accounts read, they do not write.** `users.canPost` splits "signed in" from
  "may add", which used to be the same thing — `posts.createRule` was simply
  `@request.auth.id != ""`, so any account handed to a grandparent could also post. New
  accounts default to **false**: a viewer is created by doing nothing, and posting is
  granted deliberately. `photos.createRule` carries the same check, because it is
  *not* author-scoped (the bot attaches photos to a parent's post) and would otherwise
  let a viewer add photos to someone else's memory.
  The `+` is simply not rendered for a viewer, and `initCapture` returns before wiring
  anything — but that is a courtesy. PocketBase refuses the write either way, which is
  where the rule actually lives.
- **Only the author of a memory can change it.** The pencil is rendered only on your own
  posts, and PocketBase enforces the same rule (`author = @request.auth.id` on posts,
  `post.author = @request.auth.id` on photos) so the UI is a convenience, not the
  boundary. Creation stays open to either parent.
- **Video and motion photos ride the same door.** The picker takes `image/*,video/*`; a
  Live Photo's two files are paired into one memory, and a Google motion photo is split
  into its still and its clip. The editor gains a rotate control for everything and a trim
  bar for clips — start and end handles, capped at a minute, over the clip's own frames so
  what is being chosen can be seen. No `capture` attribute on the input: it forces the
  camera and hides the library, and most memories are already on the phone.
- Photos are optional content inside that one flow, not a second door. Attach some and
  the engine makes a photo card; attach none and a caption becomes a quote card. Adding
  photos uses native camera hardware:
  `<input type="file" accept="image/*" capture="environment">`, and appends to what is
  already pending rather than starting over.
- `memoryDate` is authored, not inferred from upload time, so a new memory can be
  backdated — the timeline inserts it in date order rather than always at the top.
- **Attached media offer a date; they never impose one.** On a NEW post, when everything
  attached was taken on the same day, the date field is set to that day and says so
  underneath. It is said out loud because a field that changes by itself is otherwise
  indistinguishable from one that has gone wrong.
  - **When the media disagree, the days are OFFERED, not applied.** The field stays on
    today — there is no right answer to choose, and picking one silently would be a guess
    dressed as a fact — but `distinctDates()` puts each day one tap away as a chip under
    the field. Nothing is offered when they already agree: the field is on that day, so a
    chip would only invite a pointless tap.
  - A tapped chip counts exactly as a typed date: `dateChosenByHand` latches, and nothing
    moves the date afterwards. The chips themselves are rebuilt whenever the media change,
    even after a choice, because they are only ever an offer and a stale list is worse.
  - **Agreement, not a vote.** `agreedDate()` in `media-date.js` answers only when every
    item names the same day — one unreadable item is a disagreement, not an abstention,
    because it may well be from another day entirely. No agreement means today, which is
    at least obviously a default; a wrong date that arrived by itself is worse.
  - **Editing never moves the date, even when the photos change.** That date is something
    a parent already decided, possibly deliberately against what the files say. Nor is a
    hand-typed date ever overwritten: `dateChosenByHand` latches on the field's `input`
    event, which programmatic assignment does not fire, so it only ever hears a parent.
  - Re-run on removal too — dropping the odd one out can leave the rest agreeing after
    all, and dropping the last photo goes back to today.
  - Read from the first 256 KB for a still; a memory is not worth reading a hundred
    megabytes to date. Video skips EXIF entirely and starts at the filename: an mp4's
    creation time lives in a header that can sit at the *end* of the file.
  - A motion photo is read from the **original** the parent picked, not from the still
    split out of it — the halves are new Blobs with no name and no modification time.
- **Paging is by OFFSET, so it assumes the list underneath does not move — and backdating
  moves it.** A post inserted mid-timeline shifts every row below it down one, so the next
  page hands back a card already on screen. Appended a second time, that was a memory
  showing twice: one copy where it was placed, one where paging found it. `loadMore` now
  drops anything already in `loadedPosts` (`pickUnseen`).
  - Dedupe alone is not enough. A later page can also contain posts NEWER than one already
    placed — backdate to April while only May onwards is loaded, and April 22nd arrives on
    the next page and has to go ABOVE it. So paging no longer appends: `placeCard` puts
    every card where its date says, and paging and insertion share the one rule.
  - `hasMore` is taken from the SERVER's answer, never from how many items survived the
    filter — a page that was entirely duplicates is still a page with more behind it.
  - The mock source now KEEPS what it creates, in order. Returning the record without
    storing it made the mock better behaved than PocketBase, so a backdated post could
    never come back on a later page and this was invisible in the one place it could have
    been caught without a server.
  - Still unfixed, and the other half of the same weakness: a DELETION shifts rows the
    other way and can skip a post entirely. Cursor paging would end the whole class.
- **`loadMore` restores `loading` in a `finally`.** It did not, so one failed fetch left
  the flag set and paging stopped for the rest of the session — silently, since nothing on
  that path reports an error.
- **`data-full-w`/`data-full-h` are ALREADY oriented.** `makeViewable` writes
  `orientedSize`, so the lightbox is handed the shape the picture presents, not the shape
  the file measures. `fillRotor` turned them a second time, so a 4000x3000 photo stored at
  rotation 90 got a landscape rotor inside a correctly portrait crop frame and was squashed
  to fit. The card looked right the whole time — `rotor()` in render.js builds the same
  rotor from `orientedSize` without swapping, and the two must agree. One contract, written
  down in both places now.
- **Brightness and contrast are FRAMING, not development.** Stored as numbers on the photo
  and applied at render through one `lightFilter()`, exactly like crop, rotation and the
  trim — so the file is never re-encoded and a heavy hand costs nothing to undo. The
  gallery bakes its adjustments into a new file instead, because a print is a finished
  thing and a memory is not.
  - ONE function feeds the card, the lightbox, the compose thumbnail and the editor's live
    preview. Three implementations would eventually disagree, and only after saving.
  - It returns `''` when nothing is set, so the common case adds no compositing layer to
    every photo in the timeline.
  - The filter goes on the MEDIA element, never the rotor or the crop box — those carry
    transforms and overflow, and a filter on either would make a containing block for them.
  - **A new `number` field backfills 0, and 0 brightness is BLACK.** The migration fills
    the rows in immediately after adding the columns, and `lightFilter` reads a stored 0 as
    neutral as well. Belt and braces, deliberately: the failure mode here is every memory
    at once.
- **The editor's Done button must be unregistered on close, not `{ once: true }`.** `once`
  only tidies up when Done is what happened, and usually it is not — ESC, the back gesture
  and the backdrop all leave the listener attached for the life of the page. The next edit
  then hit the stale one first, which called `close()`, and `close` fires SYNCHRONOUSLY:
  the current `finish` ran while its own `saved` was still false, resolved null, and
  capture.js dropped the edit. Cropping, rotating and trimming all vanished silently for
  anyone who had ever dismissed the sheet without pressing Done. Long-standing, and found
  only because the new sliders gave a visible thing to check.
- **The editor sizes its framing surface in JS (`fitPane`), by WIDTH.** Everything in the
  sheet has to be reachable without scrolling, so the photo yields to the controls rather
  than the other way round. Width and not height because the surface must stay exactly the
  photo's shape — the crop rectangle and the focal dot are positioned on it as percentages,
  and capping the height of an aspect-ratio box leaves the width alone and breaks that. The
  controls are measured rather than guessed, since they differ between a still and a clip.
  Runs on open, on resize and on a quarter turn — never from `paint()`, which runs per
  pointer move.
- **A motion photo loops INSIDE its trim, and native `loop` cannot do that.** `loop`
  restarts the file, and the `#t=start,end` fragment only sets the opening position — no
  browser enforces the end across a loop. So a trimmed motion photo played the whole take
  and the trim looked as though it had never saved, while the same trim worked correctly
  in the lightbox, which applies `holdToTrim`.
  - `holdToTrim` is the VIDEO rule and pauses at the end, which is right for something
    asked to play once and wrong for a loop. `wireMotionTrim` turns the attribute off and
    rewinds instead, resuming only if the card is still on screen and nobody stopped it.
    `ended` is the backstop: timeupdate fires a few times a second, so a trim ending on
    the last frame can run out before it is noticed.
  - Tested against a stub element in `test/motion-play.test.js` rather than a browser —
    the rule is *where playback is allowed to be*, and a stub reaches the instant that
    matters instead of waiting for a decoder. That is also why the module's environment
    checks go through `globalThis` (`outOfSight`, `wantsStillness`): identical in a
    browser, and reachable from node.
- **The heading and the tab title both read "Finnbook", both written in `index.html`, and
  neither is assigned at runtime.** They match the manifest `name`, so the page, the
  home-screen icon and the share sheet all say the same word. Static is the point: filling
  either from config is what made them change under the reader mid-load. `config.babyName`
  is still the record's field and still comes back from `getConfig`, but nothing on the
  page displays it — the subtitle is the AGE, which genuinely has to be worked out.
- **Reading picked files uses `Promise.allSettled`, never `Promise.all`.** One rejection
  threw the entire batch away, so picking five photos of which one was cloud-only added
  NOTHING — and a parent who typed a caption then saved got a memory with no photos in it.
  Order still holds: allSettled resolves positionally, and position 0 leads the post.
- **The file picker and the share sheet are NOT the same capability, and the difference is
  the whole cloud-photo story.** A picker asks the OS for a file that may not exist
  locally, and a cloud-only photo comes back as a reference with no bytes behind it. The
  share sheet asks the photos app to PRODUCE a file, and it will fetch the original from
  the cloud to do so — which is why sharing to a native app "just works" where the picker
  does not. It is not a native-only power: a PWA with a `share_target` sits in the same
  sheet and receives the same materialised bytes. Verified end to end here — three files
  POSTed as `multipart/form-data` to `/share-target` land in the compose sheet as three
  thumbnails, with the inbox cache emptied after the claim.
  - Which makes the share sheet the ANSWER to an unreadable pick, not a workaround, and
    the failure message says so. It needs Finnbook installed to the home screen to appear
    in the sheet at all.
- **A file the device lists but cannot hand over is the shared-album case, and it is worth
  naming.** A photo in an album someone else owns is often only in the cloud; the picker
  shows it and produces a `File`, but the bytes are not on the device. `assertReadable`
  checks for an empty file and probes one byte BEFORE any measuring or decoding, so the
  failure is fast and says the useful thing instead of surfacing as a decode error. The
  message names the files and says what to do — open them in the photos app to download
  them first. Nothing in the picker hints at any of this: the photo is right there.
- **A photo that fails to upload is NEVER swallowed.** Both write paths caught a failed
  `photos` create, logged it to a console nobody has open, and carried on — so a memory
  with ten photos attached could save with four and still report success, with the files
  gone the moment the sheet closed. They are the only copy the app ever holds.
  - `withRetry` gives each photo three attempts, backing off 400ms then 800ms, but ONLY
    for failures that might go differently: a dropped connection (no status at all), a 429
    or a 5xx. A 400 means the record is wrong and will be wrong again.
  - What still fails comes back as `post.failedPhotos`, and the compose sheet **stays
    open** holding those photos, alongside the ones that saved. Pressing Save again edits
    the post that was just created and uploads only what is missing.
  - **The timeline is NOT told while the sheet is still open.** A post has to exist before
    its photos can — a photo record needs a post to belong to — but announcing it as soon
    as it was written put a caption-only card behind an error message saying the pictures
    had failed, which reads as the app having thrown them away. It waits in `unannounced`
    until the sheet is finished with: saved, cancelled or dismissed. Announced even on
    dismissal, because the post really is on the server and a timeline that disagrees with
    the database until the next reload is its own bug.
  - `announceHeld()` is called from every route out of the sheet rather than from the
    `close` event alone, and clears what it announces so it cannot fire twice. The
    guarantee wanted is that the timeline agrees with the database exactly once — not that
    any particular event fired.
  - **The SERVER'S OWN reason comes first, always.** PocketBase answers a rejected upload
    with `{ data: { image: { code, message } } }`, and that is exact where anything written
    here is a guess. Guessing is what went wrong: a photo over the 15 MB image limit — a
    hard 400, verified against production — was reported as a stale cloud reference, which
    sent a parent to fix something that was never broken. `serverReason()` carries it out;
    `tidyReason()` puts it in a parent's terms and passes anything unrecognised straight
    through, because a puzzling true reason beats a confident wrong one.
  - **Confirmed limits, measured not assumed:** images 15 MB (400,
    `validation_file_size_limit`), video 200 MB and restricted to mp4/quicktime/webm by
    mime type. Mime type is NOT enforced on images — PocketBase sniffs content, and a jpeg
    named `.heic`, an empty type and `image/x-adobe-dng` were all accepted. A 60 MB body
    reaches the server fine, so there is no platform limit below that.
  - **If nothing uploaded, the post does not survive.** The post has to be created before
    its photos can be, so `createPost` takes it back again when the draft had photos and
    none of them saved — a caption alone in the timeline where a picture should have been
    is not the memory anyone meant. A caption-only draft is untouched: that is a quote
    card, not a failure. It throws with `postDiscarded` and the failures attached.
  - **The failing THUMBNAILS are marked, not just named.** "PXL_20260807_194258664.jpg"
    says nothing about which picture it is. Outline plus a `!` badge, since red alone on a
    76px image is easy to miss and invisible to some; the reason rides on `title`.
  - **An upload failure re-reads the file before choosing what to say.** A file that could
    be read when it was PICKED and cannot be read now is the cloud photo: on Android a
    `content://` reference can go stale between choosing a file and sending it, so it
    measures and previews perfectly and has nothing behind it when the bytes are wanted.
    That case gets the Share → Finnbook advice; a dropped connection gets "press Save to
    try again". Both surface as a failed fetch, so the difference has to be established by
    probing rather than inferred from the error — telling a parent to download photos they
    already have would send them to fix the wrong thing.
  - Not reproducible as a server cap: ten sequential uploads of real photos to production
    all returned 200, and the client collects all ten into `pending`. So the loss was in
    transport, and the reason it could not be diagnosed afterwards IS the bug — the error
    was thrown away.
- **Captions are `white-space: pre-wrap`.** They are set with `textContent`, so the
  newlines were always in the DOM; HTML collapsed them, and a caption typed over three
  lines ran together into one.
- **A wait gets a spinner, and it is shown BEFORE the first `await`.** Reading picked media
  — EXIF, dimensions, splitting a motion photo, a clip's length — takes a noticeable moment
  on a phone, and until this the sheet sat there looking ignored. Placeholders go at the
  END of the strip while the real thumbs keep their picked order, because position 0 leads
  the post and arrival order would let a slow first pick land somewhere else. Save is
  disabled while reading: those photos belong to this memory and are not in `pending` yet,
  so saving would quietly drop them.
- **The scrubber takes touches in a 24px strip, not across its full 60px.** The width is
  for month labels; everything grabbable — rail, dots, thumb — sits within 20px of the
  edge. As a full-width `pointer-events: auto` element at `z-index: 8` it was an invisible
  column swallowing every tap beneath it, including a card's edit pencil, which at phone
  width sits 26–60px from the edge. Tapping edit scrubbed the timeline instead.
  Note the pencil could not simply be raised above it: a card is its own stacking context
  at `z-index: 1`, so nothing inside a card can out-rank an element at 8. The scrubber had
  to stop claiming ground it never used.
- A **date scrubber** rides the right edge (Google Photos style): month ticks you can
  drag to fly through the timeline, with a bubble showing where you are. It fades in
  while scrolling and idles out of sight so it never covers a memory. It is
  `aria-hidden` — a shortcut for scrolling, not a second copy of the timeline.

## Type

The baby's name at the top of the page is set in **Adam's own handwriting**
(`assets/fonts/adam.ttf`, declared in `base.css`, applied only to `.app-title`). A
scrapbook kept by two people ought to look like it was, and a name in a parent's hand does
more of that than any typeface choice.

- **Only that heading.** Everything else stays in the interface stack. Handwriting is the
  exception that means something; used twice it would just be the site's font.
- Shipped as a **TTF**, not woff2. woff2 would be about half the size, but producing one
  needs tooling this project has no dependency for — and at 22 KB, for one heading, that
  is not worth a build step.
- `font-display: swap`, so the name is readable from first paint and merely changes hand
  when the font arrives. The interface stack sits behind it in `font-family`, so a font
  that never loads costs legibility and nothing else.
- No `unicode-range`. The name is supplied by config, so narrowing the range risks one
  letter of a future name silently falling back to a different face.
- The size is larger and the letter-spacing zero, both because handwriting sits smaller on
  the line than a UI face at the same size and carries its own spacing.

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

## Migrations

Adding a field to a populated collection needs thought about what existing rows get:

- A new **`number`** field backfills with `0`, not null. That silently cropped the oldest
  photos to their top-left corner until `1754600000_backfill_focal_centre.js` repaired it.
  Write the backfill in the same change.
- A new **`json`** field reads as empty, which a well-chosen default (`cropRect()` treats
  anything falsy as the whole photo) absorbs with no backfill at all.
- A new **`text`** reads back as an **empty string**, which is the same trap again and
  bites three ways at once when the field is about to become a login identity: a unique
  index collides with itself (every row shares ''), `identityFields` set too early leaves
  nobody able to sign in, and `required` set too early makes every existing row invalid.
  `1755300000_username_login.js` therefore adds, fills, and only then constrains — the
  order is load-bearing and is commented as such.
- A new **`bool`** reads back as **false**, which for a permission field means revoking
  it from everyone. Adding `canPost` without its backfill would have silently stopped both
  parents *and* the bot from posting, and it would have looked like the app breaking
  rather than like a permissions change. `1755200000_viewer_accounts.js` sets it true for
  every account that already existed, in the same migration.
- The same `number`-backfills-0 rule made `rotation`, `trimStart` and `trimEnd` safe to
  add with **no** backfill: 0 degrees means upright, and a 0/0 trim on a row with no video
  is never read, because `trimRange()` returns nothing playable without a duration. The
  focal point needed repairing because 0 there meant "the top-left corner"; here 0 means
  exactly what absent means. Check what zero MEANS before deciding.
- PocketBase ships the `users` collection locked to `id = @request.auth.id`. That broke
  attribution invisibly — `expand=author` returned nothing for the other parent's posts.
  Test cross-account behaviour, not just your own.
- Target single-handed operation; keep tap targets large and actions reachable from the bottom.

## Serving it

**The API base is resolved, never guessed.** `js/pb.js` asks its own origin whether it
answers `/api/health` as PocketBase — once, on the way in. Guessing from the port was
wrong in the worst direction: a container on 8080 went looking for an API on 8090 that was
sitting right beside it, so the app would have worked in production and broken in the
rehearsal for it. A static file server answers 404 there, which is the whole signal.


Both servers bind to `0.0.0.0`, because a mobile-first app has to be openable on a phone.
Two things follow, and both have bitten:

- **The frontend must not hardcode `127.0.0.1`.** `js/pb.js` builds the API URL from
  `location.hostname`, so the page finds PocketBase on whatever host it was served from.
  A hardcoded loopback address means "this phone" once the page is opened on one.
- **PocketBase defaults to localhost** and needs `--http=0.0.0.0:8090` to match, or the
  page loads on the phone and then fails every fetch.

`serve.py` prints every address it can be reached at, ordinary private ones first. It does
not just probe the default route: a VPN owns that route, so on a machine running Tailscale
the probe returns a `100.x` address that a phone on the same wifi cannot use.

## Diagnosing

- **An instrument must not be able to filter out the unexpected.** The bot's arrival log
  once matched message fields against a whitelist written from memory; `live_photo` was
  not in it, so the log showed `photo` alone and that was taken as proof Telegram sent
  nothing else. It was proof of nothing. A whitelist cannot demonstrate absence — log
  everything and exclude only what is provably boring.
- **Check the spec before concluding a platform is at fault.** The same issue was written
  up as a settled Telegram limitation on that false evidence. The answer was in the Bot API
  reference the whole time.
- **Say what was measured and what was not.** Three consecutive reports of "motion photos
  do not work" had three unrelated causes — a dropped connection, client-side compression,
  and the `live_photo` field. Each was only separable because the failures were reported
  precisely rather than lumped together.

## Keeping an open scrapbook current

Posts no longer only come from the tab you are looking at: the Telegram bot writes them,
and so does the other parent's phone. `sync.js` + `syncNewPosts()` in `app.js` pick those
up without a reload.

- **Polled, not pushed.** PocketBase can stream changes over SSE, but that is a long-lived
  connection plus reconnection and re-auth handling, for two people who post a few times a
  day. A slow poll is the calmer trade. It runs **only while the tab is visible** and fires
  immediately on becoming visible — which is the case that actually matters: the phone goes
  in a pocket, something is posted, the phone comes out again.
- **A post older than the timeline is left to paging.** The timeline is paged newest-first,
  so a post older than the oldest card on screen belongs in a page not yet fetched.
  Inserting it now would place it *above* those older posts and the next page would load
  underneath it out of order. `pickNewPosts()` is pure and holds that rule.
- **An arriving memory must not shove what you are reading.** The reader's place is held by
  MEASURING a card already on screen, never by adding up the height inserted. Browsers do
  this themselves via scroll anchoring, so adding the height blindly corrects a shift that
  has already been corrected and moves the page **twice as far as it should** — which is
  exactly what the first attempt did. Measuring is self-cancelling: zero drift where the
  browser held the line, a correction where it did not.
- `insertPost(post, { reveal })` — scrolling to a memory *you* just made is helpful;
  doing it because someone else posted is not.

## Performance rules

- Timeline paging is driven by `IntersectionObserver` sentinels, never scroll-event listeners.
- Animate only `transform` (`translate3d`) and `opacity`. Never animate layout properties.
- Batch DOM reads/writes; do positional work inside `requestAnimationFrame`.
- Lazy-load images (`loading="lazy"`); rely on stored dimensions to reserve space and avoid reflow.

## Conventions

- Vanilla ES modules, no bundler. Reference files relatively.
- Keep `layout-engine.js` and `age.js` pure (no DOM, no fetch) so they stay testable.
- When adding a layout type: update the engine rules above, `render.js`, and the CSS together.
