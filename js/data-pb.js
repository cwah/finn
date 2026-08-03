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
    form.append('sort', String(i));
    try {
      saved.push(toPhoto(await pb.create('photos', form)));
    } catch (err) {
      console.error(`Photo ${i + 1} failed to upload`, err);
    }
  }

  return toPost({ ...rec, expand: { author: { id: author.id, name: author.name } } }, saved);
}
