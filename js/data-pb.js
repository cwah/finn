// Phase 2 data source: PocketBase.
//
// This module is the ONLY place that knows what a PocketBase record looks like. It
// translates records into the JSON contract from CLAUDE.md, so the layout engine, the
// renderer and the timeline stay exactly as they were in Phase 1.
//
// Collections (see pb_migrations/):
//   config  — one record: babyName, birthDate
//   posts   — memoryDate, caption, isMilestone, milestoneTitle, author -> users
//   photos  — post -> posts, image (file), width, height, alt, sort
//
// Photos are their own collection rather than a multi-file field on posts, because the
// contract needs width/height per photo — the layout engine picks a layout from stored
// dimensions and must never load an image to decide. A PocketBase file field carries no
// dimensions, so they need somewhere real to live.

import * as pb from './pb.js';

const PAGE_ORDER = '-memoryDate,-created'; // newest memory first, stable within a day

let _config = null;

/** Ensure there is a live session, refreshing the stored token. */
export async function requireSession() {
  if (!pb.isSignedIn()) return false;
  return Boolean(await pb.refresh());
}

/**
 * Sign a parent in.
 * @throws {Error} with a message fit to show, for bad credentials or an unreachable server
 */
export async function signIn(email, password) {
  try {
    await pb.signIn(email, password);
    return true;
  } catch (err) {
    if (err instanceof pb.PbError) {
      throw new Error(err.status === 400 ? 'That email and password do not match.' : err.message);
    }
    // fetch() rejects rather than returning a status when the server is not there.
    throw new Error('Cannot reach the scrapbook server. Is PocketBase running?');
  }
}

export function signOut() {
  _config = null;
  pb.signOut();
}

/** babyName + birthDate from the single config record, plus the signed-in parent. */
export async function getConfig() {
  if (!_config) {
    const out = await pb.list('config', { perPage: 1 });
    const rec = out.items[0];
    if (!rec) throw new Error('No config record — create one in the PocketBase admin UI.');
    _config = { babyName: rec.babyName, birthDate: rec.birthDate.slice(0, 10) };
  }
  const me = pb.currentUser();
  return { ..._config, currentAuthor: me ? { id: me.id, name: me.name || me.email } : null };
}

/** A photo record -> the contract's photo shape. */
function toPhoto(rec) {
  return {
    id: rec.id,
    url: pb.fileUrl('photos', rec.id, rec.image),
    width: rec.width,
    height: rec.height,
    alt: rec.alt || null,
    // Photos saved before focal points existed have none; the renderer treats a missing
    // focal point as dead centre, which is exactly how they used to be cropped.
    focalX: rec.focalX ?? null,
    focalY: rec.focalY ?? null,
    // Absent, empty or malformed all mean "the whole photo" — cropRect() decides.
    crop: rec.crop && typeof rec.crop === 'object' && rec.crop.w ? rec.crop : null,
  };
}

/** A post record (+ its photos) -> the contract's post shape. */
function toPost(rec, photos) {
  const author = rec.expand?.author;
  return {
    id: rec.id,
    // PocketBase date fields come back as "2026-03-17 00:00:00.000Z"; the contract wants
    // a plain calendar day, and age.js parses that as a LOCAL day on purpose.
    memoryDate: rec.memoryDate.slice(0, 10),
    createdAt: rec.created,
    author: author ? { id: author.id, name: author.name || author.email } : null,
    caption: rec.caption || null,
    milestone: rec.isMilestone
      ? { isMilestone: true, title: rec.milestoneTitle || 'Milestone' }
      : null,
    photos,
  };
}

/**
 * A page of posts, newest memory first.
 * @param {{page?: number, pageSize?: number}} opts
 * @returns {Promise<{items: object[], hasMore: boolean}>}
 */
export async function getPosts({ page = 0, pageSize = 5 } = {}) {
  const out = await pb.list('posts', {
    page: page + 1, // PocketBase pages are 1-based; the app's are 0-based
    perPage: pageSize,
    sort: PAGE_ORDER,
    expand: 'author',
  });

  const posts = out.items;
  const byPost = new Map(posts.map((p) => [p.id, []]));

  if (posts.length) {
    // One query for the whole page's photos rather than one per post.
    const filter = posts.map((p) => `post=${pb.quote(p.id)}`).join(' || ');
    const photos = await pb.list('photos', { filter, sort: 'sort', perPage: 200 });
    for (const rec of photos.items) byPost.get(rec.post)?.push(toPhoto(rec));
  }

  return {
    items: posts.map((rec) => toPost(rec, byPost.get(rec.id) || [])),
    hasMore: out.page < out.totalPages,
  };
}

/**
 * Save a post and its photos.
 *
 * Two steps, because the photos need the post's id. If a photo upload fails the post
 * survives with fewer photos rather than the whole save being lost — for a scrapbook,
 * keeping the words and the date beats an all-or-nothing write.
 *
 * @param {{memoryDate: string, caption: string|null, milestone: object|null,
 *          photos: Array<{file: File, width: number, height: number}>}} draft
 * @param {{id: string, name: string}} author
 */
export async function createPost(draft, author) {
  const rec = await pb.create('posts', {
    memoryDate: draft.memoryDate,
    caption: draft.caption || '',
    isMilestone: Boolean(draft.milestone),
    milestoneTitle: draft.milestone?.title || '',
    author: author.id,
  });

  const saved = [];
  for (const [i, photo] of draft.photos.entries()) {
    const form = new FormData();
    form.append('post', rec.id);
    form.append('image', photo.file);
    form.append('width', String(photo.width));
    form.append('height', String(photo.height));
    // Position in the draft IS the order: index 0 leads the post, which is what the
    // compose sheet's "make main" reorders into place.
    form.append('sort', String(i));
    if (photo.focalX != null) form.append('focalX', String(photo.focalX));
    if (photo.focalY != null) form.append('focalY', String(photo.focalY));
    try {
      saved.push(toPhoto(await pb.create('photos', form)));
    } catch (err) {
      console.error(`Photo ${i + 1} failed to upload`, err);
    }
  }

  return toPost({ ...rec, expand: { author: { id: author.id, name: author.name } } }, saved);
}

/** The post fields a parent can change. Author and creation time are not among them. */
function postBody(draft) {
  return {
    memoryDate: draft.memoryDate,
    caption: draft.caption || '',
    isMilestone: Boolean(draft.milestone),
    milestoneTitle: draft.milestone?.title || '',
  };
}

/** Upload one new photo for a post. */
async function uploadPhoto(postId, photo, sort) {
  const form = new FormData();
  form.append('post', postId);
  form.append('image', photo.file);
  form.append('width', String(photo.width));
  form.append('height', String(photo.height));
  form.append('sort', String(sort));
  if (photo.focalX != null) form.append('focalX', String(photo.focalX));
  if (photo.focalY != null) form.append('focalY', String(photo.focalY));
  if (photo.crop) form.append('crop', JSON.stringify(photo.crop));
  return toPhoto(await pb.create('photos', form));
}

/**
 * Save changes to an existing post.
 *
 * Photos are diffed rather than replaced: a draft photo that already carries an `id` is
 * one that was already on the post, so it is patched in place. Re-uploading everything
 * would burn the parent's data allowance re-sending photos that never changed, and would
 * churn the stored files for no reason.
 *
 * Removals happen first. If a later upload fails, the post is left short a photo rather
 * than holding one the parent explicitly took off it.
 *
 * @param {string} id
 * @param {object} draft same shape as createPost's, but photos may carry an `id`
 * @param {{id: string, name: string}} author
 */
export async function updatePost(id, draft, author) {
  const rec = await pb.update('posts', id, postBody(draft));

  const existing = await pb.list('photos', { filter: `post=${pb.quote(id)}`, perPage: 200 });
  const kept = new Set(draft.photos.filter((p) => p.id).map((p) => p.id));
  for (const old of existing.items) {
    if (!kept.has(old.id)) await pb.remove('photos', old.id);
  }

  const saved = [];
  for (const [i, photo] of draft.photos.entries()) {
    try {
      saved.push(
        photo.id
          // Position and framing are the only things editing can change about a photo
          // that is already stored; the file itself is never re-sent.
          ? toPhoto(await pb.update('photos', photo.id, {
            sort: i,
            focalX: photo.focalX ?? null,
            focalY: photo.focalY ?? null,
            crop: photo.crop ?? null,
          }))
          : await uploadPhoto(id, photo, i),
      );
    } catch (err) {
      console.error(`Photo ${i + 1} failed to save`, err);
    }
  }

  return toPost({ ...rec, expand: { author: { id: author.id, name: author.name } } }, saved);
}

/**
 * Remove a post. Its photos go with it — the relation is cascadeDelete — and there is no
 * trash to recover them from, so callers must confirm before calling this.
 * @param {string} id
 */
export async function deletePost(id) {
  await pb.remove('posts', id);
}
