// The signed-in account.
//
// ── THIS IS THE ONE PLACE THE TWO APPS TOUCH ─────────────────────────────────
// The scrapbook and the gallery are otherwise independent: separate directories,
// separate tests, separate CLAUDE.md, and neither imports a line of the other's code.
// This file breaks that on purpose, and it is the only file that does.
//
// They share an origin, a PocketBase and a `users` collection, so signing in twice to
// see two halves of the same family's things is a tax with nothing behind it. Reading
// the session the scrapbook already wrote means one password prompt, on one device,
// once.
//
// The cost is real and worth stating: the KEY and the SHAPE below are a contract with
// scrapbook/js/pb.js. If that file changes where it puts its session or what it puts
// there, this stops working — and it will stop working silently, by looking like
// everybody has been signed out. Anything that touches auth in either app should look
// at the other one first. Nothing else in the gallery reads localStorage, so this is
// the whole of the coupling.

/** Written by scrapbook/js/pb.js. Not ours to rename. */
const SHARED_KEY = 'scrapbook.auth';

/**
 * The stored session, or null.
 * @returns {{token: string, record: object}|null}
 */
/**
 * Whether a PocketBase auth token has passed its expiry.
 *
 * Checked here rather than left to the server, because of how PocketBase answers: a
 * request that fails a collection's listRule comes back 200 with an EMPTY LIST, not 401.
 * So an expired session did not look signed out — it looked like a gallery with nothing
 * in it, and the visitor was told "Nothing is hanging yet" instead of being asked to
 * sign in again. Tokens last about two weeks, so that was every user, every fortnight.
 *
 * Unreadable means expired. A token this cannot parse is not one worth sending.
 */
function isExpired(token) {
  try {
    const claims = JSON.parse(atob(String(token).split('.')[1]));
    // Thirty seconds of slack for a clock that is slightly fast; a token about to die
    // mid-request is better replaced now than halfway through a save.
    return !claims.exp || (Date.now() / 1000) > (claims.exp - 30);
  } catch {
    return true;
  }
}

export function readSession() {
  try {
    const raw = localStorage.getItem(SHARED_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Shape-check rather than trust: a session missing its token is the same as none,
    // and finding out here beats finding out as a 401 three requests later.
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null;
    // An expired token is worse than no token: it looks signed in and behaves signed out.
    if (isExpired(parsed.token)) return null;
    return parsed;
  } catch {
    // Corrupt or unavailable storage is the same as being signed out.
    return null;
  }
}

export function writeSession(session) {
  try {
    if (session) localStorage.setItem(SHARED_KEY, JSON.stringify(session));
    else localStorage.removeItem(SHARED_KEY);
  } catch { /* private browsing; the session just will not outlive the tab */ }
}

export function clearSession() {
  writeSession(null);
}

export function token() {
  return readSession()?.token ?? null;
}

/** The signed-in account, or null. */
export function currentUser() {
  return readSession()?.record ?? null;
}

export function isSignedIn() {
  return Boolean(token());
}

/**
 * Sign in with a username or an email and a password.
 *
 * Writes the session in the scrapbook's shape, so signing in here signs you in there
 * too. That is the point of sharing the key.
 *
 * @returns {Promise<object>} the user record
 */
export async function signIn(apiBase, identity, password) {
  const res = await fetch(`${apiBase}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  if (!res.ok) {
    throw new Error(res.status === 400
      ? 'That username and password did not match.'
      : `Sign-in failed (${res.status}).`);
  }
  const data = await res.json();
  writeSession({ token: data.token, record: data.record });
  return data.record;
}
