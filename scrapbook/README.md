# Scrapbook

A private, mobile-web-first scrapbook for two parents. No build step, no bundler — open
it and it runs. See `CLAUDE.md` for the architecture, `BACKLOG.md` for what's next,
`KNOWN-BUGS.md` for what is broken, and `../deploy/DEPLOY.md` for putting it on Render.

## Running it

Both pages need to be served over HTTP; ES modules and `fetch` don't work from `file://`.

### Phase 2 (current): with PocketBase

```sh
# 1. Start the backend. It applies pb_migrations/ on first run, creating the
#    config, posts and photos collections.
pocketbase serve --http=0.0.0.0:8090

# 2. Serve the frontend (separate terminal)
python3 serve.py
```

### Opening it on a phone

This is a mobile-first app, and the only way to know whether it feels right on a phone is
to open it on one. `serve.py` listens on `0.0.0.0` and prints every address it can be
reached at — take the ordinary `192.168.x.x` one:

```
http://localhost:8765/index.html
http://192.168.1.152:8765/index.html   <- try this one from a phone
```

**PocketBase has to be reachable too.** It defaults to localhost only, so the page would
load on the phone and then fail to fetch anything:

```sh
pocketbase serve --http=0.0.0.0:8090
```

The frontend finds the API on whatever host the page came from, so nothing needs
configuring — `js/pb.js` builds the URL from `location.hostname` rather than assuming
127.0.0.1, which on a phone means the phone.

Both servers are then on your local network, admin UI included. Fine on home wifi; worth
remembering before doing this on a café connection.

`serve.py` is `http.server` with two fixes, and **video needs both**:

- `Cache-Control: no-store` — otherwise Chrome caches ES modules heuristically, and since
  there is no build step to bust a cache, an edit appears to have no effect: the page keeps
  running the old module through a normal reload.
- **Range requests** — `http.server` ignores `Range` and returns the whole file. A phone
  writes its `moov` atom at the END of an mp4, so a browser reads metadata by asking for
  the tail, and seeks (including to the `#t=` fragment a trim uses) by asking for the
  middle. Without ranges it must download everything before playing anything, and cannot
  seek at all. PocketBase serves ranges correctly, so uploaded video is unaffected — this
  only matters for files served straight off disk, which is what `preview.html` uses.

Then open <http://localhost:8765/index.html>.

macOS quarantines anything downloaded from the internet. If the first run is blocked,
clear the flag once:

```sh
xattr -d com.apple.quarantine "$(which pocketbase)"
```

#### First-time setup

1. Open the admin UI at <http://127.0.0.1:8090/_/> and create the superuser account it
   prompts for. Keep those credentials to yourself — nothing in the app needs them.
2. In **Collections → users**, create one account per parent. Give each a `name`; that
   name is the attribution shown on every post they add.
3. In **Collections → config**, create exactly **one** record with `babyName` and
   `birthDate`. Every age stamp in the app is computed from that single date.

#### Viewer accounts

To let someone see the scrapbook without adding to it, create a `users` record as normal
and **leave `canPost` unticked**. That is the whole of it:

|                    | parent | viewer |
|--------------------|--------|--------|
| See every memory   | yes    | yes    |
| Add a memory       | yes    | no     |
| Edit or delete one | own only | no   |
| The `+` button     | shown  | not rendered |

`canPost` defaults to off, so an account is a viewer unless you say otherwise. The server
enforces it — hiding the button is only so a viewer is not offered something that would
fail. Tick `canPost` for a parent, and for the Telegram bot's own account.

### Telegram bot (optional)

A second way in: send a photo, an album, or a few words to the bot and it becomes a post,
attributed to whichever parent sent it. Layout is still inferred — the bot has no say in it.

It uses **long polling**, so nothing is exposed to the internet: the bot dials out to
Telegram, and PocketBase stays on localhost. No tunnel, no webhook, no certificate.

**Setup, once:**

1. In **Collections → users**, add an account for the bot itself (any email/password).
   The bot signs in as itself but writes each post with the sending parent as `author`.
2. Put each parent's Telegram numeric id in the `telegramId` field on their user record.
   **This mapping is the allowlist** — an account without one cannot post, and neither can
   anyone else who finds the bot. Do this for *both* parents; whoever is missing an id is
   refused. Don't know yours? Message the bot and it replies with the id to paste.
3. Fill in the settings and run it:

```sh
cp .env.example .env     # then edit it: bot token from @BotFather, bot account password
node bot/index.js
```

`.env` is gitignored and the bot reads it itself, so the token never has to be typed on a
command line where shell history would keep it. Exported variables win over the file, and
the file is optional — set the environment directly if you prefer.

**Sending:**

| You send                        | You get                                    |
|---------------------------------|--------------------------------------------|
| A photo                         | A portrait or landscape card               |
| An album of 2–4                 | One grid card                              |
| An album of 5+                  | One carousel card                          |
| Text only                       | A quote card                               |
| A video or a GIF                | A card that plays, up to a minute          |
| A live or motion photo          | A card that loops                          |
| `#milestone First steps`        | A milestone, titled "First steps"          |
| `#date 8/14`                    | Dates the memory (month first, this year)  |
| `#date two weeks ago`           | Counts back from today                     |
| Anything, from an unknown sender| A refusal, plus the id to add if it's yours |

**The post is dated from the media itself** where it can be — a photo taken on Friday and
sent on Sunday belongs on Friday. Sending as a file preserves that timestamp; the
compressed path strips it and the send date has to stand.

`#date` overrides either: `8/14`, `aug 12`, `8-14-26`, `august 14 2026`. Month comes
first, and a missing year means this one. Relative dates work too — `yesterday`,
`two weeks ago`, `last friday`, `last month` — though a vague one like "a few weeks ago"
is refused rather than guessed at. A date that lands in the future is queried
rather than saved — `12/25` in August probably means last Christmas, so say `12/25/2025`.

Live and motion photos keep their motion. Sending as a **file** also works and preserves
full resolution besides — the normal path re-encodes and caps photos at 2560px, which
costs quality on every photo, not just moving ones.

Telegram won't hand a bot any file over **20 MB**, so a long video has to go through the
app instead. The bot says so rather than failing quietly.

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

Covers the pure modules — the layout engine (layout, cropping, rotation, trimming), the
age maths, the milestone art presets, motion-photo parsing and the Telegram message
parser. No dependencies; `package.json` exists only so node runs the
specs as ES modules.

## Layout

| Path              | What it is                                            |
|-------------------|-------------------------------------------------------|
| `index.html`      | App shell                                             |
| `preview.html`    | Visual bench — every layout rendered by the live engine |
| `css/`            | One concern per file                                   |
| `js/`             | Vanilla ES modules                                     |
| `bot/`            | Telegram bot — a separate node process, not served      |
| `data/mock.json`  | Phase 1 sample data                                    |
| `pb_migrations/`  | PocketBase schema (version-controlled, auto-applied)   |
| `test/`           | `node:test` specs                                      |
| `KNOWN-BUGS.md`   | Broken behaviour, and what is known about why           |
| `../deploy/`      | Phase 3: the Dockerfile that serves this and the gallery |
| `../render.yaml`  | Render blueprint — service, plan and persistent disk    |
