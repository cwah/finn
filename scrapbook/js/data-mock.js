// Phase 1 data source: a static local JSON file. Kept alongside the PocketBase source
// so the app can still run with no backend at all — useful offline, and for working on
// layout without standing a server up. Selected in data.js.

const SOURCE = 'data/mock.json';

let _cache = null; // { config, posts } loaded once

async function load() {
  if (_cache) return _cache;
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Failed to load ${SOURCE}: ${res.status}`);
  const json = await res.json();
  // Newest memory first.
  json.posts.sort((a, b) => new Date(b.memoryDate) - new Date(a.memoryDate));
  _cache = json;
  return _cache;
}

/** No accounts without a backend — the mock source is always "signed in". */
export async function requireSession() {
  return true;
}

export async function signIn() {
  return true;
}

export function signOut() {}

/** App config (baby name, birthDate, current author). */
export async function getConfig() {
  const { config } = await load();
  // No accounts without a backend, so there is nobody to restrict: the mock source is
  // always signed in and always allowed. Present so the shape matches data-pb.js.
  return { canPost: true, ...config };
}

/**
 * A page of posts, newest first.
 * @param {{page?: number, pageSize?: number}} opts
 * @returns {Promise<{items: object[], hasMore: boolean}>}
 */
export async function getPosts({ page = 0, pageSize = 5 } = {}) {
  const { posts } = await load();
  const start = page * pageSize;
  const items = posts.slice(start, start + pageSize);
  return { items, hasMore: start + pageSize < posts.length };
}

/**
 * "Save" a post. With no backend this just builds the record the timeline will show;
 * it lives only in memory and is gone on reload.
 * @param {{memoryDate: string, caption: string|null, milestone: object|null,
 *          photos: Array<{file: File, url: string, width: number, height: number}>}} draft
 * @param {{id: string, name: string}} author
 */
/** With no backend the edit lives only in memory, same as the original post did. */
export async function updatePost(id, draft, author) {
  return {
    failedPhotos: [], // shape parity with data-pb.js; see createPost
    id,
    memoryDate: draft.memoryDate,
    createdAt: new Date().toISOString(),
    author,
    caption: draft.caption,
    location: draft.location || null,
    milestone: draft.milestone,
    photos: draft.photos.map((p, i) => ({
      id: p.id || `local-${Date.now()}-${i}`,
      url: p.url,
      // No server to resize, so one url stands in for all three — the SHAPE has to
      // match data-pb.js or the renderer would read undefined and show nothing.
      cardUrl: p.url,
      // No thumbnailer without a backend, so every size is the same file. Present so the
      // shape matches data-pb.js — the renderer reads these and must not find them absent.
      cardSet: null,
      viewUrl: p.url,
      thumbUrl: p.url,
      width: p.width,
      height: p.height,
      alt: null,
      focalX: p.focalX ?? null,
      focalY: p.focalY ?? null,
      crop: p.crop ?? null,
      rotation: p.rotation || 0,
      brightness: p.brightness ?? 1,
      contrast: p.contrast ?? 1,
      // The mock source has no storage, so a clip is previewed from its object URL —
      // but the SHAPE has to match what PocketBase returns, or the two sources drift.
      video: p.videoUrl || p.videoFile ? {
        url: p.videoUrl,
        duration: p.duration || 0,
        trimStart: p.trimStart || 0,
        trimEnd: p.trimEnd || 0,
        motion: Boolean(p.motion),
      } : null,
    })),
  };
}

export async function deletePost() {}

export async function createPost(draft, author) {
  const stamp = Date.now();
  const post = {
    id: `local-${stamp}`,
    memoryDate: draft.memoryDate,
    createdAt: new Date().toISOString(),
    author,
    caption: draft.caption,
    location: draft.location || null,
    milestone: draft.milestone,
    photos: draft.photos.map((p, i) => ({
      id: `local-${stamp}-${i}`,
      url: p.url,
      // No server to resize, so one url stands in for all three — the SHAPE has to
      // match data-pb.js or the renderer would read undefined and show nothing.
      cardUrl: p.url,
      // No thumbnailer without a backend, so every size is the same file. Present so the
      // shape matches data-pb.js — the renderer reads these and must not find them absent.
      cardSet: null,
      viewUrl: p.url,
      thumbUrl: p.url,
      width: p.width,
      height: p.height,
      alt: null,
      focalX: p.focalX ?? null,
      focalY: p.focalY ?? null,
      crop: p.crop ?? null,
      rotation: p.rotation || 0,
      brightness: p.brightness ?? 1,
      contrast: p.contrast ?? 1,
      // The mock source has no storage, so a clip is previewed from its object URL —
      // but the SHAPE has to match what PocketBase returns, or the two sources drift.
      video: p.videoUrl || p.videoFile ? {
        url: p.videoUrl,
        duration: p.duration || 0,
        trimStart: p.trimStart || 0,
        trimEnd: p.trimEnd || 0,
        motion: Boolean(p.motion),
      } : null,
    })),
  };

  // Kept, and kept IN ORDER, so paging afterwards sees the same world the real backend
  // would. Returning the record without storing it made the mock quietly better behaved
  // than PocketBase: a backdated post could never come back on a later page, so the
  // duplicate that causes was invisible here — which is the one place it could have been
  // caught without standing a server up.
  // Shape parity with data-pb.js: nothing can fail to upload without a backend, but the
  // field has to exist or the compose sheet would read undefined and skip the check.
  post.failedPhotos = [];

  const cache = await load();
  cache.posts.push(post);
  cache.posts.sort((a, b) => new Date(b.memoryDate) - new Date(a.memoryDate));
  return post;
}




/** No backend, so there is nothing to subscribe to and nothing to remember. */
export async function pushPublicKey() { return null; }
export async function savePushSubscription() { return null; }
export async function removePushSubscription() { return true; }
