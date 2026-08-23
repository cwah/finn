// Sign-in gate. One account per parent, so attribution on a post means something.
//
// Backend-agnostic on purpose: it only talks to data.js, which is what makes the mock
// source (no accounts at all) and PocketBase interchangeable without touching this file.

import { requireSession, signIn, signOut, HAS_ACCOUNTS } from './data.js';

/**
 * Resolve once there is a usable session. Shows the sign-in screen if there isn't, and
 * keeps it up until the parent gets in.
 * @returns {Promise<void>}
 */
export async function ensureSignedIn() {
  if (!HAS_ACCOUNTS) return;

  const screen = document.getElementById('signin');
  const form = document.getElementById('signinForm');
  const email = document.getElementById('signinEmail');
  const password = document.getElementById('signinPassword');
  const submit = document.getElementById('signinSubmit');
  const error = document.getElementById('signinError');

  if (await requireSession()) return;

  screen.hidden = false;
  email.focus();

  await new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        await signIn(email.value.trim(), password.value);
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
