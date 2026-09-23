// Sign-in gate. One account per parent, so attribution on a post means something.
//
// Backend-agnostic on purpose: it only talks to data.js, which is what makes the mock
// source (no accounts at all) and PocketBase interchangeable without touching this file.

import { requireSession, signIn, signOut, HAS_ACCOUNTS } from './data.js';
import { pushState, enablePush, disablePush, healPush } from './push.js';

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
  const note = document.getElementById('notifyNote');
  if (!HAS_ACCOUNTS || !btn) return;

  // Whether someone has actually asked for notifications this visit. The explanation below
  // is shown only after a tap: someone who declined on purpose should not be told about it
  // again every time they open the scrapbook.
  let asked = false;

  let state = 'off';
  const words = {
    on: 'Notifications on',
    off: 'Notifications off',
    blocked: 'Notifications blocked',
    unsupported: '',
  };
  // INSTALLED AND IN A TAB ARE DIFFERENT PLACES. Added to a home screen on Android the app
  // is a WebAPK — an Android app of its own — and the permission that matters is Android's,
  // not Chrome's. Sending someone to Chrome's site settings in that case sends them where
  // the setting is not; they find nothing wrong and conclude the app is broken. Which is
  // exactly what happened after a reinstall dropped the grant.
  const installed = window.matchMedia?.('(display-mode: standalone)')?.matches;
  const whereToAllow = installed
    ? 'Open your phone’s Settings → Apps → Finnbook → Notifications and allow them, '
      + 'then tap the bell again.'
    : 'Allow them in your browser’s site settings for this page, then tap the bell again.';

  const hints = {
    on: 'You get a notification when a new memory is added. Tap to stop.',
    off: 'Get a notification when a new memory is added.',
    blocked: `Notifications are blocked. ${whereToAllow}`,
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
    // btn.title is a tooltip and a phone has no hover, which is why being blocked was
    // invisible: the bell simply did nothing. This is the same sentence, somewhere it can
    // actually be read.
    if (note) {
      const show = state === 'blocked' && asked;
      note.textContent = show ? hints.blocked : '';
      note.hidden = !show;
    }
  };

  const refresh = async () => {
    try {
      state = await pushState();
    } catch {
      state = 'off';
    }
    paint();

    // Then quietly put right anything that has gone missing server-side since last time.
    // Separate from the read above, and after painting, because the bell should show what
    // is true NOW rather than wait on a round trip — and because a failure here must cost
    // nothing. Someone whose row has vanished gets it back without ever knowing it went.
    if (state === 'on') {
      try { await healPush(); } catch (err) { console.error('could not reaffirm notifications', err); }
    }
  };

  // COMING BACK FROM SYSTEM SETTINGS IS THE MOMENT THIS CHANGES, and the page is told
  // nothing about it: there is no event for "notifications were allowed". Without this the
  // note sits there telling someone to do the thing they have just gone and done, which
  // reads as the app being broken twice over. Returning to the tab is the closest signal
  // there is, so the state is re-read then.
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Unawaited, so it is guarded: an escaping rejection here would surface as an unhandled
    // rejection from a listener nobody is watching.
    refresh().catch((err) => console.error('could not re-read notification state', err));
  });

  btn.addEventListener('click', async () => {
    asked = true;
    btn.disabled = true;
    try {
      // A blocked bell used to return here and do nothing — permanently, because the state
      // is only re-read on load. Someone who followed the instructions and allowed
      // notifications came back to a bell that still refused. Re-read first: the permission
      // may well have been granted since, in which case this carries on normally.
      if (state === 'blocked') {
        state = await pushState();
        if (state === 'blocked') return;   // still blocked; the note says where to go
      }
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
