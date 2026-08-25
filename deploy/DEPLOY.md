# Deploying to Render

Phase 3. One Render web service running `deploy/Dockerfile`: PocketBase serves the API,
the scrapbook and Finn's art gallery from the same origin, with a persistent disk holding
the database and every photo and video.

| what | where |
|---|---|
| the scrapbook | `/` |
| the gallery | `/gallery/` — **the trailing slash matters**, see below |
| the API and admin UI | `/api/`, `/_/` |

One service rather than three on purpose — same origin means no CORS, no second deploy to
keep in step, and `scrapbook/js/pb.js` works out the API base by itself.

---

## 1. Let Render see the repo

Already done: `origin` is `github.com:cwah/finn.git` and `main` is pushed. Nothing to set
up — Render just needs permission to read it, which it asks for when you connect the
account.

Two things worth confirming while you are there:

- **The repository is private.** No secrets are tracked (`scrapbook/.env`,
  `scrapbook/pb_data/` and the bot's offset are all gitignored) but it is the family
  scrapbook, and private costs nothing.
- **Render is granted access to this repo only**, rather than to every repository on the
  account. Its GitHub app offers that choice at install time.

## 2. Create the service

Render → **Blueprints** → *New Blueprint Instance* → pick the repo. It reads
`render.yaml`, which already declares everything:

| | |
|---|---|
| Runtime | Docker |
| Plan | Starter — a persistent disk needs a paid instance |
| Disk | `pb-data`, mounted at `/pb/pb_data`, 5 GB |
| Health check | `/api/health` |
| Instances | 1 |
| Dockerfile path | `./deploy/Dockerfile` |
| Docker build context | `.` — the repo ROOT, not `deploy/` |

Doing it by hand instead works too; just match those exactly. The last two are the ones
that catch you out: the Dockerfile `COPY`s from both `scrapbook/` and `gallery/`, so a
context of `deploy/` cannot see either and the build fails on the first `COPY`. **The mount path matters**:
the Dockerfile runs PocketBase with `--dir=/pb/pb_data`, and if the disk lands anywhere
else the container will happily start with an empty database that vanishes on the next
deploy.

A Render disk can be **grown later but never shrunk**, so 5 GB is deliberate: there is
about 106 MB of media today.

## 3. Create the first superuser

On first boot PocketBase prints a one-time link to the **deploy logs**:

```
(!) Launch the URL below in the browser ... to create your first superuser account:
https://<your-service>.onrender.com/_/#/pbinstall/<token>
```

Open it from the logs. The dashboard cannot be claimed without that token, so nobody who
finds the URL first can take it — but the link does expire, and a redeploy is how you get
a fresh one.

## 4. Move the existing memories across

The scrapbook already holds real posts, photos and accounts. Do **not** re-create them by
hand — PocketBase can move the lot:

1. Locally: admin UI → **Backups** → *New backup*. Download the zip.
2. On Render: admin UI → **Backups** → *Upload backup* → then **Restore**.

That carries the database, the uploaded files, and the user accounts with their passwords,
so both parents and the bot keep working. It is around 110 MB, so give it a minute.

Restoring **replaces** everything on the Render side, which is what you want on a fresh
deploy and emphatically not what you want later. After this, the local instance is a
development copy: the memories that count live on Render.

If you would rather start clean, skip this — but then create the `config` record and the
user accounts as in `scrapbook/README.md`, or the app will refuse to load.

## 5. Move the Telegram bot across

The bot is a separate process — it is not in the container, and deploying does not move
it. Two things travel with the backup and one very much does not.

### The accounts come with the backup

Restoring (step 4) carries the whole `users` collection: both parents, the bot's own
account, their password hashes, `telegramId` and `canPost`. So the credentials already in
`scrapbook/.env` keep working and there is nothing to re-enter.

Starting clean instead means rebuilding all of it by hand, and it is easy to do
incompletely — the failure modes are quiet:

| miss this | what you see |
|---|---|
| the bot's account, same **username** and password as `.env` | the bot exits at startup, cannot sign in |
| `telegramId` on a parent | that parent is refused and told their id, as a stranger would be |
| `canPost` on the bot | posts refused 400, after the media has already been downloaded |
| `canPost` on a parent | no `+` button in the app |

### ONE bot instance, ever

This is the one that will bite. Telegram allows a single poller per token: start a second
and `getUpdates` fails with

```
Conflict: terminated by other getUpdates request; make sure that only one bot instance is running
```

So a bot pointed at Render and a bot pointed at localhost **cannot both run**, and the
one that loses is arbitrary. Before switching, stop the local one:

```sh
pkill -f "node bot/index.js"
```

If you want to keep developing against the local database while production runs, get a
**second bot from @BotFather** and use its token in a separate env file. Two tokens, two
bots, no conflict.

### The polling cursor

`scrapbook/bot/.offset` is how far through Telegram's queue the bot has read. It is
gitignored, so it does not travel with the code. Copy it if you move the bot to another
machine; without it the bot resumes from whatever Telegram still has unconfirmed, which
is usually nothing but can mean a message arriving twice.

### Point it at production

In `scrapbook/.env`:

```
PB_URL=https://<your-service>.onrender.com
```

Then `cd scrapbook && node bot/index.js`. It prints which host it signed in to, so the
first line of output confirms you are on production rather than localhost.

### Where it should actually run

**On your Mac** — nothing to set up, but the bot only runs while the machine is awake.
Telegram holds undelivered messages for about a day, so a closed laptop means memories
arrive late rather than never.

**As a Render background worker** — a second service, so a second paid instance. It needs
no Dockerfile: Render's Node runtime can run it directly, with `rootDir: scrapbook` and
`startCommand: node bot/index.js`, and no build step because there are no dependencies.
The three secrets become Render environment variables rather than `.env`, which is
gitignored and never deployed.

That second service is not in `render.yaml` — adding it would create a billable resource
the moment the blueprint is applied, which is not a decision a config file should make
quietly. Add it when you want it.

## 6. The frontend needs nothing

`scrapbook/js/pb.js` asks its own origin whether it answers as PocketBase, once, on the
way in. In
the container the answer is yes, so the API base is empty and everything is same-origin.
There is no build step and no URL to configure.

---

## Trying the container before deploying

Worth doing — it is the same image Render runs:

Run both from the **repo root** — the build context is the root, not `deploy/`:

```sh
docker build -f deploy/Dockerfile -t finn .
docker run -p 8080:8080 -v "$PWD/scrapbook/pb_data:/pb/pb_data" finn
```

Then <http://localhost:8080> for the scrapbook and <http://localhost:8080/gallery/> for
the art gallery. Mounting your real `pb_data` gives it the actual memories; leave the
`-v` off for an empty one.

This is also the cheapest place to answer the trailing-slash question below — try
<http://localhost:8080/gallery> without the slash and see what PocketBase does with it.

## The gallery's trailing slash

`/gallery/` works. `/gallery` may not, and if it does not it fails in a way that looks
like the deploy is broken rather than like a URL is.

Nothing in the gallery resolves a URL against the document — `gallery/js/paths.js`
derives the app root from `import.meta.url` — but that only protects the app *after* it
boots. Served at `/gallery` with no trailing slash, the browser resolves the page's own
`<link>` and `<script>` against the origin root, so `css/base.css` and `js/app.js` 404
and nothing runs at all. It cannot be fixed from inside the app: a `<base>` tag or
root-absolute hrefs would both hard-code the mount point and break `serve.py` locally.

Check it once against the container above. If PocketBase answers `/gallery` with a 301 to
`/gallery/`, there is nothing to do. If it serves the root `index.html` instead — the
scrapbook, to someone who asked for the gallery — add a redirect in a PocketBase JS hook so
`/gallery` always lands on `/gallery/`.

Hooks live in `deploy/pb_hooks/` and the Dockerfile copies them, so a redirect added
there will ship. There is one already: `cache.pb.js`, which makes browsers revalidate the
app's own code.

Either way, link to the gallery **with** the slash. Deep links already carry it, since
they look like `/gallery/?art=the-long-cat`.

## Things worth knowing

- **A disk pins the service to one instance.** Scaling out would give each copy its own
  disk and its own idea of the scrapbook.
- **Deploys are not zero-downtime** with a disk attached: the old container has to release
  it before the new one starts. A few seconds, on a scrapbook two people read.
- **Render's free tier cannot hold a disk**, which is why the plan is Starter. Free
  instances also sleep, and a sleeping scrapbook is a slow scrapbook.
- **The PocketBase version is pinned** in the Dockerfile, with the release's own sha256
  checked at build time. Upgrading is a deliberate edit, not something a rebuild does to
  you. Take a backup before changing it.
