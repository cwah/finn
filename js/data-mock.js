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
  return config;
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
export async function createPost(draft, author) {
  const stamp = Date.now();
  return {
    id: `local-${stamp}`,
    memoryDate: draft.memoryDate,
    createdAt: new Date().toISOString(),
    author,
    caption: draft.caption,
    milestone: draft.milestone,
    photos: draft.photos.map((p, i) => ({
      id: `local-${stamp}-${i}`,
      url: p.url,
      width: p.width,
      height: p.height,
      alt: null,
    })),
  };
}
