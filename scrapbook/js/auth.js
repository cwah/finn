// Sign-in gate. One account per parent, so attribution on a post means something.
//
// Backend-agnostic on purpose: it only talks to data.js, which is what makes the mock
// source (no accounts at all) and PocketBase interchangeable without touching this file.

import { requireSession, signIn, signOut, HAS_ACCOUNTS, setEmailNotifications } from './data.js';

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
 * The email-updates switch.
 *
 * Opt-IN: it starts off for everyone, and a deploy never signs anyone up. The wording
 * carries the state rather than only the colour — "Email updates on" / "off" — because a
 * dot alone leaves a reader guessing which way round it is.
 *
 * The button is disabled while the change is in flight and put back if it fails, so it can
 * never report a preference the server did not accept. That matters more here than usual:
 * a switch that says "on" while the server thinks otherwise means silently missing every
 * notification.
 *
 * @param {{notifyByEmail: boolean}} config as getConfig returned it
 */
export function initEmailToggle(config) {
  const btn = document.getElementById('notifyBtn');
  const label = document.getElementById('notifyLabel');
  // No accounts means no mail server and nobody to address — the switch would control
  // nothing, so it is not offered.
  if (!HAS_ACCOUNTS || !btn) return;

  let on = Boolean(config?.notifyByEmail);
  const paint = () => {
    btn.setAttribute('aria-pressed', String(on));
    label.textContent = on ? 'Email updates on' : 'Email updates off';
    btn.title = on
      ? 'You get an email when a new memory is added. Tap to stop.'
      : 'Get an email when a new memory is added.';
  };

  paint();
  btn.hidden = false;

  btn.addEventListener('click', async () => {
    const wanted = !on;
    btn.disabled = true;
    try {
      on = await setEmailNotifications(wanted);
    } catch (err) {
      console.error('could not change email updates', err);
      // Left exactly as it was. Reporting a preference the server refused is the one
      // outcome worth avoiding here.
    } finally {
      btn.disabled = false;
      paint();
    }
  });
}
