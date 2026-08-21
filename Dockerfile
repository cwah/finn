# The whole scrapbook in one container: PocketBase serving both the API and the frontend.
#
# One service rather than two on purpose. PocketBase serves static files out of
# `pb_public`, so the app and its API share an origin — no CORS, no second deploy to keep
# in step, and `js/pb.js` resolves the API to an empty base URL of its own accord.
#
# The frontend is NOT restructured into pb_public in the repo: it stays at the root so
# `python3 serve.py` keeps working for local development, and the copy happens here.
#
# Build:  docker build -t scrapbook .
# Run:    docker run -p 8080:8080 -v "$PWD/pb_data:/pb/pb_data" scrapbook

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
COPY pb_migrations/ /pb/pb_migrations/

# The frontend. Only what the app needs — preview.html is a development bench and pulls
# images from the internet, the bot is a separate process, and data/mock.json belongs to
# the no-backend mode.
COPY index.html /pb/pb_public/index.html
COPY css/ /pb/pb_public/css/
COPY js/ /pb/pb_public/js/
COPY assets/ /pb/pb_public/assets/

# Render injects PORT and expects the service to listen on it; 8080 keeps `docker run`
# working locally without one. Shell form, so the variable is actually expanded.
EXPOSE 8080
CMD /pb/pocketbase serve \
      --http=0.0.0.0:${PORT:-8080} \
      --dir=/pb/pb_data \
      --publicDir=/pb/pb_public \
      --migrationsDir=/pb/pb_migrations
