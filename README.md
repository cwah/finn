# Scrapbook

A private, mobile-web-first scrapbook for two parents. No build step, no bundler — open
it and it runs. See `CLAUDE.md` for the architecture and `BACKLOG.md` for what's next.

## Running it

Both pages need to be served over HTTP; ES modules and `fetch` don't work from `file://`.

### Phase 2 (current): with PocketBase

```sh
# 1. Start the backend. It applies pb_migrations/ on first run, creating the
#    config, posts and photos collections.
./pocketbase/pocketbase_0.39.10_darwin_arm64/pocketbase serve

# 2. Serve the frontend (separate terminal)
python3 -m http.server 8765
```

Then open <http://localhost:8765/index.html>.

macOS quarantines anything downloaded from the internet. If the first run is blocked,
clear the flag once:

```sh
xattr -d com.apple.quarantine ./pocketbase/pocketbase_0.39.10_darwin_arm64/pocketbase
```

#### First-time setup

1. Open the admin UI at <http://127.0.0.1:8090/_/> and create the superuser account it
   prompts for. Keep those credentials to yourself — nothing in the app needs them.
2. In **Collections → users**, create one account per parent. Give each a `name`; that
   name is the attribution shown on every post they add.
3. In **Collections → config**, create exactly **one** record with `babyName` and
   `birthDate`. Every age stamp in the app is computed from that single date.

### Phase 1: no backend at all

Flip one constant in `js/data.js`:

```js
export const SOURCE = 'mock';
```

The app then reads `data/mock.json`, and the sign-in screen never appears. Useful
offline and for working on layout. `preview.html` doesn't touch the data layer at all,
so it works either way.

## Tests

```sh
npm test
```

Covers the two pure modules — the layout engine and the age maths — plus the milestone
art presets. No dependencies; `package.json` exists only so node runs the specs as ES
modules.

## Layout

| Path              | What it is                                            |
|-------------------|-------------------------------------------------------|
| `index.html`      | App shell                                             |
| `preview.html`    | Visual bench — every layout rendered by the live engine |
| `css/`            | One concern per file                                   |
| `js/`             | Vanilla ES modules                                     |
| `data/mock.json`  | Phase 1 sample data                                    |
| `pb_migrations/`  | PocketBase schema (version-controlled, auto-applied)   |
| `test/`           | `node:test` specs                                      |
