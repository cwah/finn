// Data source. Phase 1: read a static local JSON file. Phase 2: swap the body of
// these functions for PocketBase REST calls — the SHAPE the rest of the app sees
// must not change. Everything else in the app is backend-agnostic.

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

/** App config (baby name, birthDate). */
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
