# Backlog

Candidates, not commitments. Format:

`- [ ] **What it is** — why, and anything that constrains it`

## Candidates

- [ ] **A real photograph for the wall** — the CSS plaster is good but a photograph of an
  actual gallery wall would be better. `css/wall.css` is already one swappable layer, so
  this is `--wall-layers: url(...)` plus `background-size: cover`. Needs a picture that
  holds up from a phone width to a wide desktop without a visible seam or a stretched
  grain.
- [ ] **Silver and antique-gold baroque** — `baroqueSvg()` already takes colours and is
  tested for it, but nothing calls it with any. Would want the variant to be part of the
  frame registry rather than a per-piece override, so it can be picked by the hash like
  everything else.
- [ ] **More frames** — a black lacquer, a whitewashed oak, a wide gilt fillet. Each is
  a registry entry and one CSS block. The set of six starts repeating at around a dozen
  drawings.
- [ ] **A shadow that widens toward the bottom** — a real frame hangs a centimetre or so
  off the wall, so its cast shadow is a trapezoid, not an offset copy. Would need a
  blurred, perspective-skewed pseudo-element promoted for the life of the page. The
  three-part box-shadow gets most of the read for none of the cost, so this is only
  worth it if the frames start looking flat at larger sizes.
- [ ] **Move the collection into PocketBase** — `js/data-pb.js` already exists and is
  held to the contract. Needs migrations, an upload path, and somewhere to type the
  placard text that is not a JSON file. The interesting question is whether the note is
  worth an admin UI or whether editing JSON is honestly fine.
- [ ] **An index view** — deliberately not built, since one-at-a-time is the whole idea.
  If it ever happens it should be a separate page and not a way out of the front one.

## Shipped

- [x] **The whole site** — wall, six frames, placard, arrows, deep links, swipe,
  keyboard, the visual bench, and 75 tests over the pure modules.
