// Subscribing this device to notifications.
//
// A subscription belongs to a DEVICE, not to an account: the same person on a phone and a
// laptop is two subscriptions, and turning it on in one place should not silently claim to
// have turned it on everywhere. So the bell reflects what THIS browser is subscribed to.
//
// Three things have to line up, and each fails differently:
//
//   a service worker   already registered for the PWA; push rides on it
//   permission         a browser prompt, which can be refused permanently
//   a subscription     the push service's endpoint, stored server-side
//
// The awkward one is a permission that was DENIED. It cannot be asked for again from
// script — the browser remembers — so the bell has to say so rather than offering a button
// that will silently do nothing.

import { savePushSubscription, removePushSubscription, pushPublicKey } from './data.js';

/** Whether this browser can do push at all. */
export function pushSupported() {
  return typeof Notification !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

/**
 * base64url VAPID key -> the Uint8Array `subscribe` insists on.
 *
 * The spec takes a BufferSource and nothing else; handing it the string it was given in
 * fails with a DOMException that says nothing about encoding.
 */
function keyBytes(base64url) {
  const padded = String(base64url).replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (String(base64url).length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** What this device is currently subscribed to, or null. */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * The bell's state, in one word.
 *
 * 'unsupported' | 'blocked' | 'on' | 'off'
 *
 * `blocked` is separated from `off` because they need different words: one is a choice the
 * person can change here, the other is a choice they can only change in browser settings.
 */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

/**
 * Subscribe this device.
 *
 * Asks for permission only when actually turning on — a page that prompts on load is a page
 * people say no to, and no is permanent.
 *
 * @returns {Promise<'on'|'blocked'|'off'>} what the bell should now say
 */
export async function enablePush() {
  if (!pushSupported()) return 'off';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';

  const key = await pushPublicKey();
  if (!key) throw new Error('no VAPID public key configured');

  const reg = await navigator.serviceWorker.ready;
  // Existing first: a browser hands back the same endpoint for the same device and site,
  // and re-subscribing without checking would be a second row for one phone.
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    // Required by every browser now — a subscription that anyone could send to is one
    // nobody will issue.
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  });

  await savePushSubscription(sub.toJSON());
  return 'on';
}

/** Unsubscribe this device, server-side first so a failure cannot leave it silently on. */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return 'off';
  // Server first: if the row survives, the device keeps buzzing, and a bell reading "off"
  // while the phone rings is worse than a failed toggle.
  await removePushSubscription(sub.endpoint);
  await sub.unsubscribe();
  return 'off';
}
