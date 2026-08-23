# finn

Two small sites about the same small person, deployed as one thing.

| | | |
|---|---|---|
| [`scrapbook/`](scrapbook/) | a private mobile scrapbook of photos and video | served at `/` |
| [`gallery/`](gallery/) | a public gallery of Finn's artwork, one drawing at a time | served at `/gallery/` |
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

## Sharing one PocketBase

Two rules, both of which are easy to get wrong once and hard to notice:

- **Namespace the gallery's collections.** The scrapbook already owns `posts`, `photos`,
  `users` and `config` — that last one especially. The gallery's go in as `gallery_*`.
  There is one migrations directory, and it is `scrapbook/pb_migrations/`.
- **Same origin means shared `localStorage`.** The scrapbook's auth token lives there
  under `scrapbook.auth`, and any script running on the gallery page can read it. The
  gallery is public and the scrapbook is not, so the gallery must never load third-party
  script or render untrusted HTML. It loads nothing external today; keep it that way.
