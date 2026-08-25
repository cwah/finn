// Signing in to add a drawing.
//
// ADMIN ONLY. Nothing on the public gallery imports this file, and that separation is
// the point: a visitor's browser never holds a token, so nothing the public page loads
// is ever in reach of a session. The scrapbook shares this origin and this PocketBase,
// which is exactly why the gallery keeps its own key and its own module.
//
// Writing is gated server-side on `canPost`, the flag on `users` that the scrapbook's
// viewer-accounts migration added. An account handed to a grandparent signs in here
// perfectly well and is refused by the collection rule, which is the right place for
// that to be decided — a hidden button is a decoration, not a permission.

import { resolveApiBase, PbError } from '../pb.js';
import { token as sessionToken, clearSession, signIn as sessionSignIn } from '../session.js';

// The session itself lives in js/session.js and is SHARED with the scrapbook: signing
// in here signs you in there too, and vice versa. This file is only the studio's use of
// it — what it needs on top is the authed fetch below and the birth date lookup.

export { currentUser as currentSession, clearSession as signOut, token } from '../session.js';

/** Sign in, resolving the API base first so callers do not have to. */
export async function signIn(identity, password) {
  const base = await resolveApiBase();
  return sessionSignIn(base, identity, password);
}

/**
 * fetch, with the session attached.
 *
 * A 401 clears the token rather than retrying. A stale token that keeps being sent looks
 * like the app is broken; being asked to sign in again looks like what it is.
 */
export async function authed(path, options = {}) {
  const base = await resolveApiBase();
  const headers = { ...(options.headers ?? {}) };
  const auth = sessionToken();
  if (auth) headers.Authorization = auth;

  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    throw new PbError('Signed out — please sign in again.', 401);
  }
  return res;
}

/**
 * Finn's birthday, from the SCRAPBOOK's private config.
 *
 * It is not on gallery_config and must not be: the gallery is public and that record is
 * world-readable, so publishing a child's date of birth there would be a decision nobody
 * made. This reads it while signed in, so the age can be worked out once and stored as a
 * whole number on the drawing.
 *
 * @returns {Promise<string|null>} yyyy-mm-dd
 */
export async function birthDate() {
  try {
    const res = await authed('/api/collections/config/records?perPage=1');
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.items?.[0]?.birthDate;
    return raw ? String(raw).slice(0, 10) : null;
  } catch {
    // A gallery admin who cannot read the scrapbook's config still gets to add art;
    // the label simply carries no age. Better than refusing to save.
    return null;
  }
}
