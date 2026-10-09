# finn

Two small sites about the same small person, deployed as one thing.

This file is the map and the traps. **The apps document themselves** — read
[`scrapbook/CLAUDE.md`](scrapbook/CLAUDE.md) before touching the scrapbook and
[`gallery/CLAUDE.md`](gallery/CLAUDE.md) before touching the gallery. Neither of those is
loaded when you are working at the repo root, which is most of why this file exists:
everything under `deploy/` belongs to both apps and to neither, and the rules below were
all learned the hard way, in production, from failures that gave no error.

## The map

```
scrapbook/     a private mobile scrapbook of photos and video   → served at /
gallery/       Finn's artwork, one drawing at a time            → served at /gallery/
deploy/        the Dockerfile and the PocketBase hooks
render.yaml    the Render blueprint; lives at the root because Blueprints expect it there
.dockerignore  also at the root, because Docker reads it from the build context
```

The two apps share an origin, a PocketBase and a `users` collection. They share no code,
with exactly one deliberate exception: `gallery/js/session.js` reads the session that
`scrapbook/js/pb.js` writes, so one sign-in covers both. That file says so at length. If
either app changes where it stores auth, the other breaks — silently, by looking as
though everybody got signed out.

## Running them

Each app is self-contained, with no build step and nothing to install.

```sh
cd scrapbook && python3 serve.py     # :8765, wants PocketBase on :8090
cd gallery   && python3 serve.py     # :8766, reads a JSON file unless SOURCE is flipped
```

Tests are per-app and there is no runner at the root: `npm test` in either directory.

## Deploying

One Render web service, one container, one persistent disk. PocketBase serves the API
and both frontends from `pb_public`. See [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

The build context is the **repo root**, not `deploy/` — every `COPY` is written from
there and `render.yaml` sets `dockerContext: .` to match.

## Sharing one PocketBase

- **Namespace the gallery's collections `gallery_*`.** The scrapbook already owns
  `posts`, `photos`, `users` and `config` — that last one especially.
- **There is one migrations directory**, `scrapbook/pb_migrations/`, and it holds the
  schema for both apps. It is the PocketBase instance's schema rather than the
  scrapbook's, and only lives there because PocketBase takes exactly one.
- **Hooks in `deploy/pb_hooks/` are deployment-level** and apply to whatever PocketBase
  serves, which is both sites.

## The traps

Every one of these shipped at least once and none of them produced an error.

**A hook callback cannot see its file's outer scope.** PocketBase runs each in its own
goja runtime, so a `const` at the top of a hook file is simply not defined by the time
the function runs. `gallery-404.pb.js` shipped that way and did nothing at all, silently,
for two deploys. Declare everything inside the handler. This is also why `cache.pb.js`
has always worked — it touches nothing outside its callback.

**PocketBase answers a failed `listRule` with 200 and an empty list, never a 401.** This
has caused three separate wrong conclusions here: that a migration had not run, that the
API was still public, and that a gallery was empty when the session had merely expired.
A 200 is not evidence of permission. Look at `items`.

**`.dockerignore` patterns must name their app.** They are matched from the context root,
so a bare `test/` only ever matches a top-level one. And `gallery/data/` must ship while
`scrapbook/data/` must not — one is the collection, the other a no-backend fixture. They
look alike and are opposites; the file says so where it matters.

**Every `COPY` is a named file or a named directory**, so a new page at the top level of
an app does not ship until it is listed. `admin.html` was missing from the image for a
while and *looked* deployed, because an unmatched path under `/gallery/` used to be
answered with the root `index.html` and a 200. There is a simulation of the
`.dockerignore` against every `COPY` in the history; run something like it after adding
an asset.

**Deploys are not zero-downtime** with a disk attached — the old container has to release
it first. A 502 during a check is almost always the swap, not a fault. Poll for several
consecutive healthy responses before concluding anything.

**A PocketBase file is public by URL unless its field is declared `protected`.** Neither
app declares one, so the bytes are readable by anyone holding the link. That is a
deliberate trade and `gallery/js/pb.js` explains it: declaring the fields protected would
require a file token in the query string, and a token that changes every page load is a
fresh cache key that quietly destroys the year-long `immutable` caching in `cache.pb.js`.

**A new number or bool field reads back as 0 or false on every existing row.** The
scrapbook's `1755200000_viewer_accounts` documents this for bools and it has recurred
since for numbers — `ageMonths: 0` is indistinguishable from an age nobody worked out.
Decide what zero *means* before deciding whether a backfill is needed, and say which you
chose in the migration.

## Conventions

No build step and no dependencies, in either app. `package.json` exists only so node runs
the tests as ES modules.

Commit messages are sentence case and imperative, with no prefixes, emoji or
conventional-commits tags, and they explain intent rather than listing changes. The body
is where a decision and the failure it prevents get written down; several of the traps
above were recovered from commit messages rather than from code.

`pb_data/` is gitignored. The real one is `scrapbook/pb_data/`; a smaller one at the root
is a leftover from running PocketBase from the wrong directory and is not used by
anything.
