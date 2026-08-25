// Minimal PocketBase REST client — the read-only half.
//
// Hand-rolled rather than pulling the official SDK, because the project rule is no
// bundler and no dependencies, and the slice the public gallery needs is tiny: list
// some records, build a file URL.
//
// The gallery used to be public and this file used to have no auth in it at all. It is
// password-protected now, like the scrapbook, so every request carries the session —
// see js/session.js, which is the one place the two apps deliberately share anything.
//
// Everything above this layer speaks the JSON contract in CLAUDE.md, not PocketBase.
// Record shapes are translated in data-pb.js; nothing PocketBase-specific escapes it.

/**
 * Where the API lives.
 *
 * Two arrangements exist and they are not distinguishable by looking: PocketBase serving
 * the page itself (production, and the container run locally), where the API is
 * same-origin and the base is empty; or the development flow, where the gallery comes
 * off serve.py on its own port and PocketBase is separately on 8090.
 *
 * So this ASKS, once, rather than guessing from the port — guessing is wrong in the
 * worst direction, working in production and failing in the rehearsal for it. Same
 * reasoning as scrapbook/js/pb.js, which solves this for the other app; the two are
 * deliberately not shared, since one app importing the other's code is the thing the
 * repo layout exists to prevent.
 */
import { token } from './session.js';

let apiBase = null;

export async function resolveApiBase() {
  if (apiBase !== null) return apiBase;
  try {
    // Same-origin, so this costs nothing when the answer is yes. A static file server
    // answers 404 here, which is the whole signal.
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (res.ok) {
      apiBase = '';
      return apiBase;
    }
  } catch { /* the page's own origin is not PocketBase */ }
  // The host the page came from, never a hardcoded 127.0.0.1 — this gets opened on a
  // phone, where localhost is the phone.
  apiBase = `http://${location.hostname || '127.0.0.1'}:8090`;
  return apiBase;
}

/** An error that carries the status, so callers can tell "empty" from "broken". */
export class PbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PbError';
    this.status = status;
  }
}

/**
 * GET a page of records from a collection.
 * @param {string} collection
 * @param {Object<string, string|number>} [params] PocketBase query params
 * @returns {Promise<{items: Array, totalItems: number}>}
 */
export async function list(collection, params = {}) {
  const base = await resolveApiBase();
  const auth = token();
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  const url = `${base}/api/collections/${collection}/records?${query}`;

  const res = await fetch(url, {
    cache: 'no-store',
    headers: auth ? { Authorization: auth } : {},
  });
  // 401 and 403 are both "you are not allowed to see this", and the caller turns either
  // into the sign-in gate. They are kept distinct from a 500 on purpose: one means show
  // a password box, the other means something is broken.
  if (!res.ok) throw new PbError(`${collection} responded ${res.status}`, res.status);
  return res.json();
}

/**
 * The URL of a file attached to a record.
 *
 * Built here rather than in the caller so that data-pb.js can hand the frontend an
 * absolute URL and nothing downstream ever joins a path — the one rule that lets the
 * static and PocketBase sources be swapped without the app noticing.
 *
 * @param {{collectionName: string, id: string}} record
 * @param {string} filename as stored on the record
 * @returns {string} '' when there is no file, so a caller can test it plainly
 */
export function fileUrl(record, filename) {
  if (!record?.id || !filename) return '';
  const base = apiBase ?? '';
  const url = `${base}/api/files/${record.collectionName}/${record.id}/${encodeURIComponent(filename)}`;

  // A protected file cannot be fetched by an <img> tag, which sends no Authorization
  // header and cannot be given one. PocketBase's answer is a short-lived file token
  // passed in the query string; requestFileToken() gets one and app.js appends it.
  // Without this the collection rules close and every frame goes empty.
  return url;
}

/**
 * A short-lived token for reading protected files.
 *
 * Needed because an <img> cannot carry an Authorization header. Returns '' when there
 * is no session, which is the signed-out case and is handled upstream.
 *
 * @returns {Promise<string>}
 */
export async function requestFileToken() {
  const auth = token();
  if (!auth) return '';
  const base = await resolveApiBase();
  const res = await fetch(`${base}/api/files/token`, {
    method: 'POST',
    headers: { Authorization: auth },
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data?.token ?? '';
}
