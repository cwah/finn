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
 *
 * `identity` is a username or an email address. PocketBase decides which are accepted —
 * `identityFields` on the users collection — so nothing here needs to change if that list
 * is ever narrowed or widened.
 *
 * @throws {Error} with a message fit to show, for bad credentials or an unreachable server
 */
export async function signIn(identity, password) {
  try {
    await pb.signIn(identity, password);
    return true;
  } catch (err) {
    if (err instanceof pb.PbError) {
      throw new Error(err.status === 400
        ? 'Those details do not match an account.' : err.message);
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
  return {
    ..._config,
    currentAuthor: me ? { id: me.id, name: me.name || me.email } : null,
    // Whether this account may ADD to the scrapbook, as opposed to read it. The stored
    // record is refreshed by requireSession() on the way in, so this is current without
    // a request of its own. The server enforces it regardless — this only decides
    // whether a viewer is shown a button that would fail.
    canPost: Boolean(me?.canPost),
  };
}

/** A photo record -> the contract's photo shape. */
function toPhoto(rec) {
  return {
    id: rec.id,
    url: pb.fileUrl('photos', rec.id, rec.image),
    // A card is at most 560 CSS px wide and the compose strip is 76: neither has any use
    // for a 3000px original, and fetching one for each is most of what made a timeline
    // slow to fill in. The lightbox still asks for `url`, because expanding a photo is the
    // one place the whole thing is wanted.
    cardUrl: pb.fileUrl('photos', rec.id, rec.image, '1280x1280f'),
    thumbUrl: pb.fileUrl('photos', rec.id, rec.image, '320x320f'),
    width: rec.width,
    height: rec.height,
    alt: rec.alt || null,
    // Photos saved before focal points existed have none; the renderer treats a missing
    // focal point as dead centre, which is exactly how they used to be cropped.
    focalX: rec.focalX ?? null,
    focalY: rec.focalY ?? null,
    // Absent, empty or malformed all mean "the whole photo" — cropRect() decides.
    crop: rec.crop && typeof rec.crop === 'object' && rec.crop.w ? rec.crop : null,
    // 0 on every row that predates rotation, which is exactly what upright means.
    rotation: rec.rotation || 0,
    // Light, held like framing and applied at render. A row that predates these fields
    // reads 0, which lightFilter() takes as neutral — see the migration, which is where
    // the zeros are actually put right.
    brightness: rec.brightness || 1,
    contrast: rec.contrast || 1,
    // A row with no video file is a still, and nothing downstream asks again.
    video: rec.video ? {
      url: pb.fileUrl('photos', rec.id, rec.video),
      duration: rec.duration || 0,
      trimStart: rec.trimStart || 0,
      // 0 reads as "to the end", which trimRange() then caps at a minute.
      trimEnd: rec.trimEnd || 0,
      motion: Boolean(rec.isMotion),
    } : null,
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
/**
 * Try a photo a few times before giving up on it.
 *
 * A phone uploading ten photos over mobile data is the worst case this app has: tens of
 * megabytes, one request each, and a locked screen or a lift is enough to drop one. A
 * single blip should not cost a memory when trying again a second later almost always
 * works.
 *
 * Only worth retrying what might succeed next time. A 400 means the record is wrong and
 * will be just as wrong on the third go; a dropped connection, a 5xx or a 429 will not.
 */
async function withRetry(attemptFn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await attemptFn();
    } catch (err) {
      last = err;
      // PbError carries the status; a network failure is a TypeError with none at all,
      // which is exactly the case most worth retrying.
      const status = err?.status;
      const worthRetrying = !status || status === 429 || status >= 500;
      if (!worthRetrying || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i)); // 400ms, 800ms
    }
  }
  throw last;
}

/**
 * Why the SERVER refused a photo, in its own words.
 *
 * PocketBase answers a rejected upload with `{ data: { image: { code, message } } }`, and
 * that message is exact where anything written here would be a guess:
 *
 *   "Failed to upload IMG_3312.jpg - the maximum allowed file size is 15728640 bytes."
 *
 * Guessing is what went wrong before. A failed upload was reported as a stale cloud
 * reference because that was the cause I had in mind, and a photo genuinely on the device
 * but over 15 MB — verified against production, it is a hard 400 — got advice that could
 * not have helped. The server knows; the job here is to carry what it said rather than
 * substitute a theory for it.
 *
 * @returns {string|null} null when the server said nothing, e.g. the request never arrived
 */
function serverReason(err) {
  const fields = err?.data;
  if (!fields || typeof fields !== 'object') return null;
  for (const detail of Object.values(fields)) {
    if (detail && typeof detail.message === 'string' && detail.message) return detail.message;
  }
  return null;
}

/**
 * What a photo failure looks like to the caller.
 *
 * The draft photo is carried back, not just a message, so the compose sheet can put the
 * ones that did not make it back in front of the parent and let them try again — the file
 * is still in memory at that point, and it is the only copy the app will ever have.
 */
function describeFailure(photo, index, err) {
  return {
    photo,
    index,
    status: err?.status ?? null,
    // The server's own words where there are any; `message` is only ever the fallback.
    reason: serverReason(err),
    message: err?.message || String(err),
  };
}

export async function createPost(draft, author) {
  const rec = await pb.create('posts', {
    memoryDate: draft.memoryDate,
    caption: draft.caption || '',
    isMilestone: Boolean(draft.milestone),
    milestoneTitle: draft.milestone?.title || '',
    author: author.id,
  });

  const saved = [];
  const failed = [];
  for (const [i, photo] of draft.photos.entries()) {
    try {
      // Position in the draft IS the order: index 0 leads the post, which is what the
      // compose sheet's "make main" reorders into place.
      saved.push(toPhoto(await withRetry(() => pb.create('photos', photoForm(rec.id, photo, i)))));
    } catch (err) {
      // NOT swallowed. This used to be a console.error and nothing else, so a parent who
      // attached ten photos over a flaky connection was told the memory had saved while
      // six of them had been dropped on the floor — and the files were gone with the sheet.
      console.error(`Photo ${i + 1} failed to upload`, err);
      failed.push(describeFailure(photo, i, err));
    }
  }

  // A memory that was ABOUT photos, none of which arrived, is not a memory — it is a
  // caption sitting alone in the timeline where a picture should have been. The post has
  // to be created before its photos can be (a photo record needs a post to belong to), so
  // the only way to honour that is to take it back again.
  //
  // Only when the draft HAD photos: a caption on its own is a quote card, and a perfectly
  // good post with nothing to fail.
  if (draft.photos.length && !saved.length) {
    try {
      await pb.remove('posts', rec.id);
    } catch (err) {
      // Leaving an empty post behind is bad; losing the reason the photos failed is worse,
      // because that is the thing the parent needs to see. Log and carry on.
      console.error('could not remove the post whose photos all failed', err);
    }
    const nothing = new Error('no photos could be uploaded');
    nothing.failedPhotos = failed;
    nothing.postDiscarded = true;
    throw nothing;
  }

  const post = toPost({ ...rec, expand: { author: { id: author.id, name: author.name } } }, saved);
  post.failedPhotos = failed;
  return post;
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

/**
 * Everything a photo record is made of, in one place.
 *
 * Creating a post and adding a photo to an existing one build the same record, and when
 * they each had their own copy of this they drifted: the create path never sent `crop`,
 * so a crop chosen before the first save was silently thrown away.
 */
function photoForm(postId, photo, sort) {
  const form = new FormData();
  form.append('post', postId);
  form.append('image', photo.file);
  // The stored dimensions are the FILE's. Rotation and crop are applied at render, so
  // what is written here never changes when either is edited.
  form.append('width', String(photo.width));
  form.append('height', String(photo.height));
  form.append('sort', String(sort));
  if (photo.focalX != null) form.append('focalX', String(photo.focalX));
  if (photo.focalY != null) form.append('focalY', String(photo.focalY));
  if (photo.crop) form.append('crop', JSON.stringify(photo.crop));
  if (photo.rotation) form.append('rotation', String(photo.rotation));
  // Always sent, never conditionally: a neutral 1 must reach the row, or the column keeps
  // the 0 it was created with and the photo would be read as black by anything that has
  // not been taught otherwise.
  form.append('brightness', String(photo.brightness ?? 1));
  form.append('contrast', String(photo.contrast ?? 1));

  // A video rides along with the poster frame that stands in for it. Non-destructive
  // like the crop: the whole file is stored and the trim says which part is the memory.
  if (photo.videoFile) {
    form.append('video', photo.videoFile);
    form.append('duration', String(photo.duration || 0));
    form.append('trimStart', String(photo.trimStart || 0));
    form.append('trimEnd', String(photo.trimEnd || 0));
    form.append('isMotion', photo.motion ? 'true' : 'false');
  }
  return form;
}

/** Upload one new photo for a post. */
async function uploadPhoto(postId, photo, sort) {
  return toPhoto(await pb.create('photos', photoForm(postId, photo, sort)));
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
  const failed = [];
  for (const [i, photo] of draft.photos.entries()) {
    try {
      saved.push(
        photo.id
          // Position and framing are the only things editing can change about a photo
          // that is already stored; the file itself is never re-sent. Rotation and the
          // trim belong here for the same reason the crop does — all three are framing,
          // held apart from the file so they can be undone forever.
          ? toPhoto(await withRetry(() => pb.update('photos', photo.id, {
            sort: i,
            focalX: photo.focalX ?? null,
            focalY: photo.focalY ?? null,
            crop: photo.crop ?? null,
            rotation: photo.rotation || 0,
            brightness: photo.brightness ?? 1,
            contrast: photo.contrast ?? 1,
            trimStart: photo.trimStart || 0,
            trimEnd: photo.trimEnd || 0,
          })))
          : await withRetry(() => uploadPhoto(id, photo, i)),
      );
    } catch (err) {
      console.error(`Photo ${i + 1} failed to save`, err);
      failed.push(describeFailure(photo, i, err));
    }
  }

  const post = toPost({ ...rec, expand: { author: { id: author.id, name: author.name } } }, saved);
  post.failedPhotos = failed;
  return post;
}

/**
 * Remove a post. Its photos go with it — the relation is cascadeDelete — and there is no
 * trash to recover them from, so callers must confirm before calling this.
 * @param {string} id
 */
export async function deletePost(id) {
  await pb.remove('posts', id);
}
