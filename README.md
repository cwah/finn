# finn

Two small sites about the same small person, deployed as one thing.

| | | |
|---|---|---|
| [`scrapbook/`](scrapbook/) | a private mobile scrapbook of photos and video | served at `/` |
| [`gallery/`](gallery/) | Finn's artwork, one drawing at a time | served at `/gallery/` |
| [`deploy/`](deploy/) | the Dockerfile that serves both, plus how to put it on Render | |

They share an origin and a PocketBase instance, and nothing else. Neither imports the
other's code, and each has its own `CLAUDE.md`, its own tests and its own dev server —
they are neighbours, not one application.

## Running them

Each app is self-contained. There is no build step and nothing to install for either.

```sh
cd scrapbook && python3 serve.py     # http://localhost:8765
cd gallery   && python3 serve.py     # http://localhost:8766
```

The scrapbook also wants PocketBase running on 8090; see `scrapbook/README.md`. The
gallery reads a JSON file and needs nothing.

Tests are per-app, and there is no runner at the root:

```sh
cd scrapbook && npm test
cd gallery   && npm test
```

## Deploying

One Render web service, one container, one persistent disk. PocketBase serves the API
and both frontends. See [`deploy/DEPLOY.md`](deploy/DEPLOY.md) — including the note on
the gallery's trailing slash, which is the one thing about this arrangement that can
fail confusingly.

The build context is the repo root, not `deploy/`; `render.yaml` at the root says so.

## Both are installable

Each site is a progressive web app in its own right: its own manifest, its own icons, its
own service worker. Added to a phone's home screen either opens standalone, with no
browser chrome.

**They are genuinely two apps, not one with two pages.** Each manifest declares its own
`id` — `/` and `/gallery/` — which is what a browser keys an installed app on. Install
both and you get two home-screen icons, two entries in the browser's app list, and two
standalone windows, each opening at its own `start_url` and staying inside its own scope.

What they cannot have, sharing an origin, is separate storage: cookies, `localStorage` and
IndexedDB are per-origin, so the scrapbook's auth token is readable from a gallery page.
That is why the gallery must never load third-party script — see below.

**Both appear in the system share sheet.** Share a photo from the camera roll and the
scrapbook opens its compose sheet with it already attached; share a drawing and the
gallery opens its studio with it loaded. A share target POSTs into the app and there is no
server here to receive it, so the service worker catches the POST, parks the files in a
cache, and answers with a 303 — the page that follows claims them from there.

| | scrapbook | gallery |
|---|---|---|
| Accepts | images, video, motion photos | images only |
| Opens | the compose sheet | `admin.html`, image loaded |

Shared files travel the **same path as ones chosen by hand**: they are put on the app's own
file input and it is told to fire. Live Photo pairing, motion-photo splitting, poster
frames, smart crop and the minute-long trim all already live behind that handler, and a
second route in would be a second one to keep in step.

Share targets are a Chrome/Android feature. iOS does not offer one, so on an iPhone both
apps install and run but do not appear in the share sheet.

**The workers are scoped apart.** A service worker can only control its own directory and
below, so the gallery's covers `/gallery/` and nothing else. The scrapbook's sits at the
root and would otherwise shadow it, so it explicitly passes `/gallery/` requests through.

**Caching is network-first for code, in both.** This is not the usual advice and it is
deliberate: a stale cached module already broke sign-in on the scrapbook once, and a
service worker cache is worse than an HTTP one — it survives a hard reload, so the usual
way out does not work. Online you always get what was deployed; the cache is consulted
only when the network fails.

The two differ in what offline means for them:

| | scrapbook | gallery |
|---|---|---|
| Offline | the shell, not the memories | the whole collection |
| Why | `/api/` is never cached — auth tokens, private posts and family photos have no business on disk, and a stale copy would show memories that were deleted | five drawings under dated filenames whose contents never change, precached on install by reading the manifest |

## Sharing one PocketBase

Two rules, both of which are easy to get wrong once and hard to notice:

- **Namespace the gallery's collections.** The scrapbook already owns `posts`, `photos`,
  `users` and `config` — that last one especially. The gallery's go in as `gallery_*`.
  There is one migrations directory, and it is `scrapbook/pb_migrations/`.
- **They share a sign-in, deliberately.** Both apps are private, both authenticate
  against the same `users` collection, and the gallery reads the session the scrapbook
  writes — `scrapbook.auth` in `localStorage`. Signing in to either signs you in to
  both. `gallery/js/session.js` is the ONLY place the two apps touch, and the key and
  the shape in it are a contract with `scrapbook/js/pb.js`: change where either stores
  auth and the other breaks, silently, by looking like everyone got signed out.
- **Neither app may load third-party script.** One origin, one session, two apps — so
  anything running on either page can read the token for both.
