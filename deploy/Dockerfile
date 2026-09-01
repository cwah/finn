# Both of Finn's sites in one container: PocketBase serving the API, the scrapbook and
# the gallery.
#
# One service rather than three on purpose. PocketBase serves static files out of
# `pb_public`, so the apps and the API share an origin — no CORS, no second deploy to
# keep in step, and `scrapbook/js/pb.js` resolves the API to an empty base URL of its
# own accord.
#
# Neither frontend is restructured into pb_public in the repo: each stays where it is so
# `python3 serve.py` keeps working in either directory, and the copy happens here.
#
# The build context is the REPO ROOT, not this directory — every COPY below is written
# from there, and `render.yaml` sets `dockerContext: .` to match.
#
# Build:  docker build -f deploy/Dockerfile -t finn .
# Run:    docker run -p 8080:8080 -v "$PWD/scrapbook/pb_data:/pb/pb_data" finn

# ── Fetch the binary, and prove it is the one we meant ────────────────────────
FROM alpine:3.21 AS fetch

# Pinned deliberately. An unpinned "latest" would mean a deploy could change the backend
# under a scrapbook that is already full of memories.
ARG PB_VERSION=0.39.10
# From the release's own checksums.txt. Verified genuine by checking the darwin build of
# the same release against the copy already running locally.
ARG PB_SHA256=67f68c8041dbb6a35fd7af5997ffc5063a7a7b96bf9df810360788f9e9975408

RUN apk add --no-cache ca-certificates unzip wget

RUN wget -q -O /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
 && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
 && unzip -q /tmp/pb.zip -d /pb/ \
 && chmod +x /pb/pocketbase

# ── The image that actually runs ──────────────────────────────────────────────
FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=fetch /pb/pocketbase /pb/pocketbase

# Schema is source, and travels with the code. It lives OUTSIDE pb_data on purpose: the
# persistent disk mounts over pb_data, so anything baked in there would be hidden the
# moment the volume appeared.
#
# PocketBase takes ONE migrations directory. When the gallery gets its own migrations
# they have to land in here too — a second COPY into the same path, with collection
# names namespaced (`gallery_*`) so they cannot collide with the scrapbook's.
COPY scrapbook/pb_migrations/ /pb/pb_migrations/

# Hooks. Deployment-level rather than per-app: they apply to whatever PocketBase serves,
# which is both sites. cache.pb.js makes the browser revalidate the app's own code — see
# the note in it for the sign-in bug that shipped without it.
COPY deploy/pb_hooks/ /pb/pb_hooks/

# ── The scrapbook, at the root ────────────────────────────────────────────────
# Only what the app needs — preview.html is a development bench, the bot is a separate
# process, and data/mock.json belongs to the no-backend mode.
COPY scrapbook/index.html          /pb/pb_public/index.html
COPY scrapbook/manifest.webmanifest /pb/pb_public/manifest.webmanifest
# The worker must sit at the ROOT to claim the whole origin as its scope. A worker can
# only ever control its own directory and below.
COPY scrapbook/sw.js               /pb/pb_public/sw.js
COPY scrapbook/css/       /pb/pb_public/css/
COPY scrapbook/js/        /pb/pb_public/js/
COPY scrapbook/assets/    /pb/pb_public/assets/

# ── The gallery, under /gallery/ ──────────────────────────────────────────────
# `gallery/data/` IS shipped, unlike the scrapbook's: it is the collection itself, not a
# development fixture. `gallery/tools/` is not — it measures images at authoring time.
#
# The trailing slash on /gallery/ is load-bearing. Served at /gallery without it, the
# browser resolves the gallery's own <link> and <script> against the origin root, they
# 404, and the page never boots. See "Where the app is mounted" in gallery/CLAUDE.md.
COPY gallery/index.html          /pb/pb_public/gallery/index.html
COPY gallery/manifest.webmanifest /pb/pb_public/gallery/manifest.webmanifest
COPY gallery/assets/             /pb/pb_public/gallery/assets/
# Beside the gallery, not at the root: its scope is /gallery/ and nothing above.
COPY gallery/sw.js               /pb/pb_public/gallery/sw.js
# admin.html ships too — adding a drawing from a phone is the point of it. It is
# noindex, it signs in against the same users collection as the scrapbook, and writing
# is refused server-side for accounts without canPost, so shipping it grants nothing
# that a URL alone could exploit. Note that it is a NAMED file: everything else here is
# a directory, and a page added beside index.html will not ship until it is listed.
COPY gallery/admin.html /pb/pb_public/gallery/admin.html
COPY gallery/css/       /pb/pb_public/gallery/css/
COPY gallery/js/        /pb/pb_public/gallery/js/
COPY gallery/data/      /pb/pb_public/gallery/data/
COPY gallery/art/       /pb/pb_public/gallery/art/

# Render injects PORT and expects the service to listen on it; 8080 keeps `docker run`
# working locally without one. Shell form, so the variable is actually expanded.
EXPOSE 8080
CMD /pb/pocketbase serve \
      --http=0.0.0.0:${PORT:-8080} \
      --dir=/pb/pb_data \
      --publicDir=/pb/pb_public \
      --migrationsDir=/pb/pb_migrations \
      --hooksDir=/pb/pb_hooks
