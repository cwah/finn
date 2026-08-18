// Minimal PocketBase REST client.
//
// Hand-rolled rather than pulling the official SDK, because the project rule is no
// bundler and no dependencies — and the slice of the API this app needs is small:
// password auth, listing records, creating records with file uploads.
//
// Everything above this layer speaks the JSON contract in CLAUDE.md, not PocketBase.
// Record shapes are translated in data-pb.js; nothing PocketBase-specific escapes it.

/**
 * Where the API lives. Served by PocketBase itself (pb_public) it is same-origin, so
 * the empty string is right. In the dev flow the frontend comes off a plain static
 * server on another port, so PocketBase is found beside it.
 *
 * Beside it on the SAME HOST the page came from, never a hardcoded 127.0.0.1: this is a
 * mobile-first app and it gets opened on a phone, where localhost is the phone itself.
 * The page would load and then fail to reach a backend running on someone else's machine.
 */
export const PB_URL = location.port === '8090' || location.protocol === 'https:'
  ? ''
  : `http://${location.hostname || '127.0.0.1'}:8090`;

const TOKEN_KEY = 'scrapbook.auth';

let auth = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY)) || null;
  } catch {
    return null; // corrupt entry is the same as being logged out
  }
}

function persist(next) {
  auth = next;
  if (next) localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
  else localStorage.removeItem(TOKEN_KEY);
}

/** The signed-in parent, or null. `{ id, name, email }` */
export function currentUser() {
  return auth ? auth.record : null;
}

export function isSignedIn() {
  return Boolean(auth && auth.token);
}

export function signOut() {
  persist(null);
}

/** Thrown for any non-2xx response, carrying the status so callers can branch on 401. */
export class PbError extends Error {
  constructor(status, body) {
    super(body?.message || `PocketBase request failed (${status})`);
    this.name = 'PbError';
    this.status = status;
    this.data = body?.data || null;
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };

  if (body instanceof FormData) {
    opts.body = body; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (auth?.token) opts.headers.Authorization = auth.token;

  const res = await fetch(`${PB_URL}${path}`, opts);
  const payload = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    // A rejected token is indistinguishable from being logged out — drop it so the app
    // shows the sign-in screen instead of looping on failed requests.
    if (res.status === 401) persist(null);
    throw new PbError(res.status, payload);
  }
  return payload;
}

/**
 * Sign in one of the parents.
 * @param {string} email
 * @param {string} password
 */
export async function signIn(email, password) {
  const out = await request('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: { identity: email, password },
  });
  persist({ token: out.token, record: out.record });
  return out.record;
}

/** Exchange a still-valid token for a fresh one, and confirm the session is real. */
export async function refresh() {
  if (!auth?.token) return null;
  try {
    const out = await request('/api/collections/users/auth-refresh', { method: 'POST' });
    persist({ token: out.token, record: out.record });
    return out.record;
  } catch (err) {
    if (err instanceof PbError && err.status === 401) return null; // already cleared
    throw err;
  }
}

/**
 * List records from a collection.
 * @param {string} collection
 * @param {{page?: number, perPage?: number, sort?: string, filter?: string, expand?: string}} q
 */
export async function list(collection, q = {}) {
  const params = new URLSearchParams({ page: String(q.page ?? 1), perPage: String(q.perPage ?? 30) });
  if (q.sort) params.set('sort', q.sort);
  if (q.filter) params.set('filter', q.filter);
  if (q.expand) params.set('expand', q.expand);
  return request(`/api/collections/${collection}/records?${params}`);
}

/** Create a record. Pass FormData when the record carries a file. */
export async function create(collection, body) {
  return request(`/api/collections/${collection}/records`, { method: 'POST', body });
}

/** Patch a record. Only the fields you pass are touched. */
export async function update(collection, id, body) {
  return request(`/api/collections/${collection}/records/${id}`, { method: 'PATCH', body });
}

/** Delete a record. Relations marked cascadeDelete go with it. */
export async function remove(collection, id) {
  return request(`/api/collections/${collection}/records/${id}`, { method: 'DELETE' });
}

/** Public URL for a file stored on a record. */
export function fileUrl(collectionIdOrName, recordId, filename) {
  return `${PB_URL}/api/files/${collectionIdOrName}/${recordId}/${filename}`;
}

/** Escape a value for use inside a PocketBase filter string. */
export function quote(value) {
  return `"${String(value).replace(/["\\]/g, '\\$&')}"`;
}
