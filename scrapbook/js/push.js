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
 *
 * Exported only so it can be tested. It is the one piece of this module that is pure and
 * the one most able to fail quietly: a key decoded to the wrong bytes still subscribes,
 * and the push is then rejected much later by a service that says only 401.
 */
export function keyBytes(base64url) {
  const padded = String(base64url).replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (String(base64url).length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Whether a subscription was taken out with the key the server signs with now.
 *
 * ROTATING THE VAPID PAIR INVALIDATES EVERY SUBSCRIPTION MADE UNDER THE OLD ONE. The
 * browser keeps handing the old one back regardless — `getSubscription()` knows nothing
 * about whose key it was — so the server signs with the new key, the push service rejects
 * it, and nothing arrives. Nothing reports this: the bell reads the browser's
 * subscription, sees one, and says "on".
 *
 * `options.applicationServerKey` is the key it was actually created with, so the two can
 * be compared. Where a browser does not expose it, the subscription is assumed current —
 * throwing away a working subscription over a missing field would be worse than the bug.
 */
export function matchesKey(subscription, key) {
  const held = subscription?.options?.applicationServerKey;
  if (!held) return true;
  const a = new Uint8Array(held);
  const b = keyBytes(key);
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
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
  let existing = await reg.pushManager.getSubscription();

  // Unless it was taken out under a DIFFERENT server key, in which case it is already
  // dead and reusing it is how a rotation silently stops every device at once. Dropped and
  // taken out again, which is the only way to get one that matches.
  if (existing && !matchesKey(existing, key)) {
    try { await existing.unsubscribe(); } catch { /* already gone; subscribe afresh below */ }
    existing = null;
  }

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

/**
 * Put right, on every load, whatever has gone missing since the last one.
 *
 * The bell reads the BROWSER's subscription, and that is only half the truth. The server
 * has a row too, and it can disappear on its own: the notifier deletes a row whose push
 * came back 404 or 410, a restored backup can predate it, a rotation makes it useless. The
 * browser still has its subscription, so the bell says "on", and the person is told they
 * are subscribed while nothing will ever arrive again. That is exactly the shape of
 * "notifications keep turning themselves off".
 *
 * ONLY EVER FOR SOMEONE ALREADY SUBSCRIBED. A device with no subscription has either never
 * enabled it or deliberately turned it off, and quietly signing them back up would be a
 * far worse bug than the one this fixes. Permission alone is not consent — it outlives the
 * choice that granted it.
 *
 * @returns {Promise<'on'|'off'>} what the bell should say
 */
export async function healPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return 'off';

  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return 'off';   // not subscribed: leave it that way

  const key = await pushPublicKey();
  if (!key) return 'on';    // nothing to check against, and nothing to be gained by trying

  if (!matchesKey(sub, key)) {
    // Taken out under a key the server no longer signs with. Useless, and re-saving it
    // would just re-record something dead.
    try { await sub.unsubscribe(); } catch { /* already gone */ }
    const fresh = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
    await savePushSubscription(fresh.toJSON());
    return 'on';
  }

  // The subscription is current; make sure the server still knows about it. The upsert is
  // scoped to this person and this endpoint, so saying so twice costs nothing.
  await savePushSubscription(sub.toJSON());
  return 'on';
}
