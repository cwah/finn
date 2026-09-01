// Sign-in gate. One account per parent, so attribution on a post means something.
//
// Backend-agnostic on purpose: it only talks to data.js, which is what makes the mock
// source (no accounts at all) and PocketBase interchangeable without touching this file.

import { requireSession, signIn, signOut, HAS_ACCOUNTS } from './data.js';
import { pushState, enablePush, disablePush } from './push.js';

/**
 * Resolve once there is a usable session. Shows the sign-in screen if there isn't, and
 * keeps it up until the parent gets in.
 * @returns {Promise<void>}
 */
export async function ensureSignedIn() {
  if (!HAS_ACCOUNTS) return;

  const screen = document.getElementById('signin');
  const form = document.getElementById('signinForm');
  const username = document.getElementById('signinUsername');
  const password = document.getElementById('signinPassword');
  const submit = document.getElementById('signinSubmit');
  const error = document.getElementById('signinError');

  if (await requireSession()) return;

  screen.hidden = false;
  username.focus();

  await new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        await signIn(username.value.trim(), password.value);
        password.value = ''; // don't leave it sitting in the DOM
        screen.hidden = true;
        resolve();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        password.select();
      } finally {
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    });
  });
}

/** Wire the header's sign-out control, hidden entirely when there are no accounts. */
export function initSignOut() {
  const btn = document.getElementById('signOutBtn');
  if (!HAS_ACCOUNTS) return;
  btn.hidden = false;
  btn.addEventListener('click', () => {
    signOut();
    location.reload(); // simplest correct reset — drops every cached page of posts
  });
}


/**
 * The bell.
 *
 * A subscription belongs to a DEVICE, not an account, so this reflects what THIS browser is
 * subscribed to — turning it on here must not claim to have turned it on everywhere.
 *
 * Four states, and each needs different words:
 *
 *   on           subscribed; tapping unsubscribes
 *   off          not subscribed; tapping asks the browser for permission
 *   blocked      permission was refused, and script CANNOT ask again — the browser
 *                remembers. Offering a button that would silently do nothing is worse than
 *                saying where the setting actually lives.
 *   unsupported  no push here at all. On an iPhone that means Safari rather than the
 *                installed app: iOS grants push only to a PWA on the home screen.
 */
export function initNotifications() {
  const btn = document.getElementById('notifyBtn');
  const label = document.getElementById('notifyLabel');
  if (!HAS_ACCOUNTS || !btn) return;

  let state = 'off';
  const words = {
    on: 'Notifications on',
    off: 'Notifications off',
    blocked: 'Notifications blocked',
    unsupported: '',
  };
  const hints = {
    on: 'You get a notification when a new memory is added. Tap to stop.',
    off: 'Get a notification when a new memory is added.',
    blocked: 'Your browser is blocking notifications for this site — allow them in its '
      + 'site settings, then tap again.',
  };

  const paint = () => {
    btn.hidden = state === 'unsupported';
    btn.setAttribute('aria-pressed', String(state === 'on'));
    btn.classList.toggle('is-blocked', state === 'blocked');
    // Guarded. The label is decoration — it is visually hidden on narrow screens anyway —
    // and reading .textContent off a null would throw from inside paint(), which runs on
    // every state change including the first. A missing span is not worth a dead bell.
    if (label) label.textContent = words[state] || '';
    btn.title = hints[state] || '';
  };

  const refresh = async () => {
    try {
      state = await pushState();
    } catch {
      state = 'off';
    }
    paint();
  };

  btn.addEventListener('click', async () => {
    if (state === 'blocked') return; // nothing script can do; the title says where to go
    btn.disabled = true;
    try {
      state = state === 'on' ? await disablePush() : await enablePush();
    } catch (err) {
      console.error('could not change notifications', err);
      // Re-read rather than assume: the truth is whatever the browser and server now hold,
      // and a bell reading "on" while nothing is subscribed is the one useless outcome.
      await refresh();
    } finally {
      btn.disabled = false;
      paint();
    }
  });

  // RETURNED, not fired and forgotten. refresh() reads browser state and can reject —
  // getRegistration() throws in some embedded webviews — and a rejection from an unawaited
  // call escapes the optional() wrapper entirely, surfacing as an unhandled rejection with
  // the bell stuck on whatever it last said. Handing the promise back is what makes the
  // wrapping actually cover this function.
  return refresh();
}
