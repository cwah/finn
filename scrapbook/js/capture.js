// Capture flow. ONE entry point: the floating + opens the compose sheet, and media is
// attached from inside it via the native picker
// (<input type="file" accept="image/*,video/*" multiple>).
//
// That keeps a single door for every kind of memory — attach photos, videos, motion
// photos, or nothing at all, and the engine decides what the post becomes. A sheet saved with no photos and a caption
// lands as a quote card; there is no separate "write a note" button to choose first.
//
// The sheet is the ONLY place a post is authored, and it holds no layout choices,
// because the engine decides layout from the content alone.
//
// Saving goes through data.js — this module never knows whether that lands in
// PocketBase or only in memory. Photos preview through object URLs while composing;
// the File itself rides along so the data layer can upload it.

import { createPost, updatePost, deletePost } from './data.js';
import { detectFocalPoint } from './smart-crop.js';
import { pairLivePhotos, splitMotionPhoto, looksLikeMotion } from './motion.js';
import { MAX_CLIP_SECONDS, lightFilter } from './layout-engine.js';
import { exifDate, filenameDate, agreedDate, distinctDates } from './media-date.js';
import { openPhotoEditor } from './photo-editor.js';
import { dateLabel } from './age.js';

/** Today as a LOCAL calendar day — toISOString() would hand back UTC and can skew a day. */
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Read intrinsic dimensions of an image File via an object URL. Stored dimensions are
 * what let the layout engine and CSS reserve space without ever loading the image.
 * @param {File} file
 * @returns {Promise<{url: string, width: number, height: number}>}
 */
function measure(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * Read a video's dimensions and length, and grab a still from it to stand in as its
 * poster. That poster IS the photo everything else reasons about — the layout engine,
 * the crop box and the grid never learn that motion is involved.
 *
 * @param {File|Blob} file
 * @returns {Promise<{url, width, height, duration, poster: Blob}>}
 */
function measureVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const fail = (why) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read video: ${file.name || 'clip'} (${why})`));
    };

    video.onerror = () => fail('unsupported format');
    video.onloadedmetadata = () => {
      // Seek a little way in: the very first frame of a phone clip is often the
      // half-exposed one from the moment recording started.
      video.currentTime = Math.min(0.1, video.duration / 10);
    };
    video.onseeked = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return fail('no dimensions');

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(video, 0, 0);
      return canvas.toBlob((poster) => {
        if (!poster) return fail('could not grab a still');
        return resolve({ url, width, height, duration: video.duration || 0, poster });
      }, 'image/jpeg', 0.85);
    };
    video.src = url;
  });
}

/**
 * One picked file (or a paired still + movie) -> one pending item.
 *
 * The three ways motion arrives all end up in the same shape, so nothing above here has
 * to know which kind it was:
 *   a plain image                  -> a still
 *   a still paired with a movie    -> a motion photo (Apple)
 *   a jpeg with an mp4 inside it   -> a motion photo (Google)
 *   a movie on its own             -> a video, poster grabbed from its own frames
 */
/**
 * Fail early, and for a reason worth reporting, on a file the device cannot actually hand
 * over.
 *
 * A photo in a shared album is often only in the cloud. The picker still lists it and
 * still produces a File, but the bytes are not here, and everything downstream then fails
 * in its own way — a decode error, a zero-size image, a rejected arrayBuffer — none of
 * which says the useful thing. One byte is enough to know.
 */
async function assertReadable(file) {
  if (!file) return;
  const name = file.name || 'that file';
  if (file.size === 0) throw new Error(`“${name}” is empty on this device`);
  try {
    await file.slice(0, 1).arrayBuffer();
  } catch {
    throw new Error(`“${name}” could not be read from this device`);
  }
}

async function readItem(entry) {
  // Before any of the expensive work: measuring, decoding, splitting a motion photo.
  await assertReadable(entry.still || entry.video);

  // A movie with no still of its own: its poster is a frame of itself.
  if (!entry.still) {
    const { url: videoUrl, width, height, duration, poster } = await measureVideo(entry.video);
    return {
      file: new File([poster], 'poster.jpg', { type: 'image/jpeg' }),
      // The thumbnail and the crop surface show the POSTER; the clip is previewed from
      // its own url in the editor. Two urls because they are two different files.
      url: URL.createObjectURL(poster),
      videoUrl,
      width,
      height,
      videoFile: entry.video,
      takenOn: await takenOn(entry.video),
      duration,
      trimStart: 0,
      // Longer than a minute is accepted and opened at the first minute, so the parent
      // picks which minute matters rather than being sent back to their phone.
      trimEnd: Math.min(duration, MAX_CLIP_SECONDS),
      motion: looksLikeMotion(duration),
      // A frame grabbed from a video has no focal point of its own worth detecting;
      // dead centre is what an unframed photo has always meant.
      focalX: null,
      focalY: null,
    };
  }

  // A still, possibly with a movie beside it or hidden inside it.
  let still = entry.still;
  let video = entry.video || null;
  if (!video) {
    const split = await splitMotionPhoto(still);
    still = split.still;
    video = split.video;
  }

  const [{ url, width, height }, focal] = await Promise.all([
    measure(still),
    detectFocalPoint(still),
  ]);
  const item = {
    file: still, url, width, height, focalX: focal.x, focalY: focal.y,
    // Read from the ORIGINAL the parent picked, not from `still` — a Google motion photo
    // has had its clip split off by now, and the halves are new Blobs with no name and no
    // modification time of their own.
    takenOn: await takenOn(entry.still),
  };
  if (!video) return item;

  // The still is the poster; the clip only has to supply its length.
  let duration = 0;
  let videoUrl = null;
  try {
    ({ duration, url: videoUrl } = await measureVideo(video));
  } catch {
    return item; // an unreadable clip leaves a perfectly good photo behind
  }
  return {
    ...item,
    videoFile: video,
    videoUrl,
    duration,
    trimStart: 0,
    trimEnd: Math.min(duration, MAX_CLIP_SECONDS),
    motion: looksLikeMotion(duration),
  };
}

/** A timestamp as a LOCAL calendar day, the same way todayISO reckons one. */
function localDay(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * When a file was taken, as well as the browser can tell.
 *
 * In order of how much it can be trusted:
 *
 *   EXIF        the photographer's own timestamp, and the only one that is really the
 *               moment rather than a fact about the file. Read from the first 256 KB —
 *               EXIF sits near the front of a jpeg, and a memory is not worth reading a
 *               hundred megabytes to date.
 *   filename    PXL_20260807_..., IMG_..., VID_... Survives copying, which EXIF does not
 *               always. Used for VIDEO first: an mp4 keeps its creation time in a header
 *               that can sit at the END of the file, and reading a whole clip to find it
 *               is a poor trade on a phone.
 *   lastModified  a fact about the file rather than the moment, and often just when it
 *               was copied. Last, and only because a date the parent can see and correct
 *               beats no date at all.
 *
 * @returns {Promise<string|null>} YYYY-MM-DD
 */
async function takenOn(file) {
  if (!file) return null;
  const isVideo = (file.type || '').startsWith('video/');

  if (!isVideo) {
    try {
      const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
      const exif = exifDate(head);
      if (exif) return exif;
    } catch { /* unreadable is simply unknown */ }
  }

  const named = filenameDate(file.name);
  if (named) return named;

  return file.lastModified ? localDay(file.lastModified) : null;
}

/** Opens the sheet on an existing post. Set by initCapture; used by app.js. */
export let openForEdit = () => {};

/**
 * Open a new memory with files already attached — what the system share sheet hands over.
 *
 * Deliberately routed through the SAME picker handler an ordinary attachment goes through,
 * by putting the files on the input and letting it fire. Live Photo pairing, motion photo
 * splitting, poster frames, dimensions, smart crop and the 60-second trim all already
 * happen there, and a second path would be a second place for them to stop happening.
 */
export let openWithFiles = (files) => {
  // Loud on purpose. This is the value the export holds until initCapture replaces it,
  // and calling it means the files have already been claimed and the cache emptied — so
  // a silent no-op here is a share destroyed rather than a share deferred. It shipped
  // exactly once, as "sharing does nothing".
  console.error(`openWithFiles called before initCapture — ${files?.length ?? 0} shared `
    + 'file(s) will be lost. It must be called after the compose sheet is wired.');
};

/**
 * Wire the compose sheet, which both creates and edits.
 *
 * One sheet for both on purpose: a separate edit form would be a second authoring
 * surface to keep in step, and every field means the same thing in both directions.
 *
 * A viewer account gets none of this. The `+` is the only way in, so not wiring it is
 * enough — and it is only a courtesy: PocketBase refuses the write regardless, which is
 * where the rule actually lives.
 *
 * @param {{author: {id: string, name: string}, canPost: boolean}} options the signed-in
 *        account, for attribution and for whether it may add anything
 * @param {{onCreate: (post) => void, onUpdate: (post) => void, onDelete: (id) => void}} handlers
 */
export function initCapture({ author, canPost = true }, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  const input = document.getElementById('capture');
  const composeBtn = document.getElementById('composeBtn');
  const addLabel = document.getElementById('composeAddLabel');
  const sheet = document.getElementById('compose');
  const form = document.getElementById('composeForm');
  const thumbs = document.getElementById('composePhotos');
  const caption = document.getElementById('composeCaption');
  const date = document.getElementById('composeDate');
  const dateNote = document.getElementById('composeDateNote');
  const datePicks = document.getElementById('composeDatePicks');
  const isMilestone = document.getElementById('composeMilestone');
  const milestoneTitle = document.getElementById('composeMilestoneTitle');
  const saveBtn = document.getElementById('composeSave');
  const cancelBtn = document.getElementById('composeCancel');
  const saveError = document.getElementById('composeError');
  const title = document.getElementById('composeTitle');
  const deleteBtn = document.getElementById('composeDelete');

  let pending = []; // photos on the post being composed
  // Media picked but not yet decoded. A big photo off a phone takes a noticeable moment —
  // EXIF, dimensions, splitting a motion photo, reading a clip's length — and until this
  // was shown, choosing five photos looked exactly like the picker having done nothing.
  let reading = 0;
  // Once a parent sets the date by hand, nothing may move it again.
  let dateChosenByHand = false;
  let editing = null; // the post being edited, or null when composing a new one

  /**
   * Only object URLs belong to us — those are previews of files picked in this session.
   * A photo already stored on the server has an https URL and must not be revoked.
   */
  function releasePending() {
    pending.forEach((p) => {
      if (!p.file) return; // an existing photo's url belongs to the server, not to us
      URL.revokeObjectURL(p.url);
      if (p.videoUrl) URL.revokeObjectURL(p.videoUrl); // a clip has a second one
    });
    pending = [];
  }

  /** Save is live once there is something to show — a photo or a real caption. */
  function syncSaveState() {
    // Nothing may be saved mid-read: those photos are part of this memory and are not in
    // `pending` yet, so saving now would quietly drop them.
    saveBtn.disabled = reading > 0 || (pending.length === 0 && caption.value.trim() === '');
  }

  function renderThumbs() {
    thumbs.replaceChildren(
      ...pending.map((p, i) => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'compose-thumb';
        // First photo leads the post: it fills the wide cell on a three-photo grid and
        // opens the carousel. Worth labelling, since it is not obvious otherwise.
        if (i === 0) cell.classList.add('is-main');
        cell.setAttribute('aria-label', `Photo ${i + 1} of ${pending.length}. Edit framing.`);

        const img = new Image();
        img.src = p.url;
        img.alt = '';
        if (p.focalX != null) img.style.objectPosition = `${p.focalX * 100}% ${p.focalY * 100}%`;
        // The strip is the only view of a photo between framing it and saving, so it has
        // to show what was set — otherwise brightening one and returning to a row of
        // untouched thumbnails reads as the adjustment not having taken.
        img.style.filter = lightFilter(p);
        cell.append(img);

        if (i === 0) {
          cell.append(Object.assign(document.createElement('span'), {
            className: 'compose-thumb-tag',
            textContent: 'Main',
          }));
        }

        cell.addEventListener('click', () => editPhoto(i));

        // Remove sits outside the framing button so a mis-tap cannot delete a photo.
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'compose-thumb-drop';
        drop.innerHTML = '&times;';
        drop.setAttribute('aria-label', `Remove photo ${i + 1}`);
        drop.addEventListener('click', (e) => {
          e.stopPropagation();
          const [gone] = pending.splice(i, 1);
          if (gone.file) URL.revokeObjectURL(gone.url); // only ours to revoke
          renderThumbs();
          // Removing the odd one out can leave the rest agreeing after all, so the date
          // is worked out again from whatever is left — including back to today when the
          // last photo goes.
          applyInferredDate();
          syncSaveState();
        });

        const wrap = document.createElement('div');
        wrap.className = 'compose-thumb-wrap';
        wrap.append(cell, drop);
        return wrap;
      }),
    );
    // Placeholders for what is still being read, after the thumbs that are ready. They sit
    // at the end because the real ones keep their picked order, which decides the main
    // photo — arrival order would let a slow first pick end up somewhere else.
    for (let i = 0; i < reading; i += 1) {
      const wait = document.createElement('div');
      wait.className = 'compose-thumb-wrap compose-thumb-loading';
      const spin = document.createElement('span');
      spin.className = 'spinner';
      wait.append(spin);
      wait.setAttribute('aria-label', 'Reading a photo');
      thumbs.append(wait);
    }

    thumbs.hidden = pending.length === 0 && reading === 0;
    // The picker takes video too, and a label that only mentions photos reads as a
    // restriction. "Add more" once something is attached — by then the kind is obvious.
    addLabel.textContent = reading
      ? `Reading ${reading} item${reading === 1 ? '' : 's'}…`
      : (pending.length ? 'Add more' : 'Add photos or videos');
  }

  /** Reframe a photo, or promote it to lead the post. */
  async function editPhoto(i) {
    const result = await openPhotoEditor(pending[i], { isMain: i === 0 });
    if (!result) return;

    pending[i] = {
      ...pending[i],
      focalX: result.focalX,
      focalY: result.focalY,
      crop: result.crop,
      rotation: result.rotation,
      brightness: result.brightness,
      contrast: result.contrast,
      // Only a video carries a trim; the editor leaves these undefined for a still.
      ...(result.trimStart != null ? { trimStart: result.trimStart } : {}),
      ...(result.trimEnd != null ? { trimEnd: result.trimEnd } : {}),
    };
    if (result.makeMain && i !== 0) {
      // Promotion is a reorder, so it survives straight through as photo order — the
      // renderer and the backend both already treat position 0 as the lead.
      const [chosen] = pending.splice(i, 1);
      pending.unshift(chosen);
    }
    renderThumbs();
  }

  /**
   * Date the memory from the media on it, when the media agree.
   *
   * NEW POSTS ONLY. Editing an existing memory never moves its date, even if the photos
   * on it change: that date is something a parent already decided, possibly deliberately
   * against what the files say, and re-deriving it would silently undo them.
   *
   * Nor does it touch a date typed by hand. Between the two, the parent is always right.
   *
   * When the media disagree there is no answer, so it goes back to today rather than
   * picking a winner — a wrong date that arrived by itself is worse than today's, which
   * is at least obviously a default.
   */
  function applyInferredDate() {
    // Editing never touches the date, and never offers to: that date is already decided.
    if (editing) return;

    const days = distinctDates(pending.map((p) => p.takenOn));
    const agreed = agreedDate(pending.map((p) => p.takenOn));

    // A date typed or tapped by a parent is final. The SUGGESTIONS are still rebuilt
    // below, because they are only ever an offer and a stale list would be worse.
    if (!dateChosenByHand) date.value = agreed || todayISO();

    const settled = Boolean(agreed) && !dateChosenByHand;
    dateNote.textContent = settled
      ? 'Date taken from the media you added — change it if it\u2019s wrong.'
      : '';
    dateNote.hidden = !settled;

    renderDatePicks(days);
  }

  /**
   * Offer the days the media were taken on, when they do not agree.
   *
   * The field itself stays on today — there is no right answer to choose, and picking one
   * silently would be a guess dressed as a fact. But the days ARE the best candidates
   * there are, and leaving them buried in the files means a parent squinting at a phone
   * to work out which afternoon this was.
   *
   * Nothing is offered when the media already agree: the field is on that day, so a chip
   * repeating it would only invite a pointless tap.
   */
  function renderDatePicks(days) {
    datePicks.replaceChildren();
    if (days.length < 2) {
      datePicks.hidden = true;
      return;
    }

    const lead = document.createElement('span');
    lead.className = 'compose-date-picks-lead';
    lead.textContent = 'Taken on:';
    datePicks.append(lead);

    for (const day of days) {
      const pick = document.createElement('button');
      pick.type = 'button'; // inside a form: a bare button would submit it
      pick.className = 'compose-date-pick';
      pick.textContent = dateLabel(day);
      pick.setAttribute('aria-label', `Use ${dateLabel(day)} as the date`);
      pick.addEventListener('click', () => {
        date.value = day;
        // A tap is a decision, so nothing may move the date afterwards — the same rule a
        // typed date gets. The chips stay, so a wrong tap costs one more tap.
        dateChosenByHand = true;
        dateNote.hidden = true;
        markChosen();
      });
      datePicks.append(pick);
    }
    markChosen();
    datePicks.hidden = false;
  }

  /** Show which offered day, if any, the field is currently on. */
  function markChosen() {
    for (const pick of datePicks.querySelectorAll('.compose-date-pick')) {
      const on = dateLabel(date.value) === pick.textContent;
      pick.classList.toggle('is-chosen', on);
      pick.setAttribute('aria-pressed', String(on));
    }
  }

  /**
   * A saved post's photos, in the shape `pending` uses.
   *
   * Existing photos carry an id and a server URL, so the data layer knows to patch them in
   * place rather than re-uploading a file it already has.
   */
  function storedAsPending(post) {
    return post.photos.map((p) => ({
      id: p.id,
      url: p.url,
      width: p.width,
      height: p.height,
      focalX: p.focalX,
      focalY: p.focalY,
      crop: p.crop,
      rotation: p.rotation || 0,
      brightness: p.brightness ?? 1,
      contrast: p.contrast ?? 1,
      // The video comes back as a URL, not a File — it is already stored, and editing
      // only ever changes where the trim sits, never the file behind it.
      videoUrl: p.video?.url || null,
      duration: p.video?.duration || 0,
      trimStart: p.video?.trimStart || 0,
      trimEnd: p.video?.trimEnd || 0,
      motion: Boolean(p.video?.motion),
    }));
  }

  /**
   * Open the sheet. With a post, it edits that post; without, it composes a new one.
   * @param {object|null} post
   */
  function open(post = null) {
    releasePending();
    editing = post;

    if (post) {
      pending = storedAsPending(post);
    }

    title.textContent = post ? 'Edit memory' : 'New memory';
    deleteBtn.hidden = !post;
    saveError.hidden = true;
    caption.value = post?.caption || '';
    reading = 0;
    dateChosenByHand = false;
    datePicks.replaceChildren();
    datePicks.hidden = true;
    dateNote.hidden = true;
    date.value = post?.memoryDate || todayISO();
    date.max = todayISO(); // a memory can't have happened tomorrow
    isMilestone.checked = Boolean(post?.milestone);
    milestoneTitle.value = post?.milestone?.title || '';
    milestoneTitle.hidden = !isMilestone.checked;

    renderThumbs();
    syncSaveState();
    sheet.showModal();
    caption.focus();
  }

  function close() {
    releasePending();
    if (sheet.open) sheet.close();
  }

  // ── The single entry point ───────────────────────────────────────
  // A viewer wires nothing at all: no button, no listeners, and openForEdit left as the
  // no-op it starts as, so there is no authoring surface to reach even by accident.
  // Hidden rather than disabled — a greyed-out button invites a parent to wonder what
  // they did wrong, and a viewer is not a broken parent, they are reading.
  if (!canPost) {
    composeBtn.hidden = true;
    return;
  }

  openForEdit = open;
  composeBtn.addEventListener('click', () => open());

  openWithFiles = (files) => {
    if (!files?.length) return;
    open();                       // fresh sheet first: open() clears whatever was pending
    const carrier = new DataTransfer();
    for (const file of files) carrier.items.add(file);
    input.files = carrier.files;
    input.dispatchEvent(new Event('change'));
  };

  /** Whatever the picker called it, for saying which one could not be read. */
  function nameOf(entry) {
    return entry?.still?.name || entry?.video?.name || 'one of them';
  }

  /**
   * Why some of what was picked could not be read, and what to do about it.
   *
   * Names the files, because "one of those" leaves a parent to work out which of five it
   * was by elimination.
   *
   * The shared-album cause is called out by name because it is both common and invisible:
   * a photo in an album someone else owns often is not on the phone at all, only in the
   * cloud, and the picker hands over a reference the browser cannot then read. Nothing
   * about the picker suggests that — the photo is right there in the grid.
   *
   * The advice is to SHARE rather than to download, because sharing is the path that
   * works. A file picker asks the OS for a file that may not exist locally; the share
   * sheet asks the photos app to PRODUCE one, and it will fetch the original from the
   * cloud to do it. That is the same route a native app gets, and this app already has a
   * share target — so the capability was never missing, only the signpost.
   */
  function readFailureMessage(lost, total) {
    const named = lost.slice(0, 3).join(', ') + (lost.length > 3 ? '…' : '');
    // Whole clauses per case, not a noun phrase glued to one verb: "None of those 5" in
    // front of "could not be read" is a double negative that says they were all fine.
    const clause = lost.length < total
      ? `${lost.length} of those ${total} could not be read`
      : (total === 1 ? 'That photo could not be read' : `None of those ${total} could be read`);
    return `${clause} (${named}). `
      + 'Photos in a shared album are often only in the cloud, not on this phone. '
      + 'Open them in your photos app and use Share \u2192 Finnbook instead: that makes '
      + 'the phone fetch the full photo. Saving them to your device first also works.'
      + (lost.length < total ? ' The rest were added.' : '');
  }

  // Photos arrive from inside the open sheet, so they ADD to what is already pending
  // rather than starting a new post.
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = ''; // allow re-picking the same file
    if (!files.length) return;
    // A Live Photo arrives as two files that only a matching name ties together, so
    // pairing happens before anything is measured — two files, one memory.
    const entries = pairLivePhotos(files);

    // Say so BEFORE the first await, or the sheet sits there looking ignored for exactly
    // as long as the work takes.
    reading += entries.length;
    renderThumbs();
    syncSaveState();
    // allSettled, NOT all. One unreadable file must not cost the readable ones: with
    // Promise.all a single rejection threw the whole batch away, so picking five photos of
    // which one was cloud-only added NOTHING and the parent was left with a caption and no
    // memory. Order is still the order picked, because allSettled resolves positionally.
    const results = await Promise.allSettled(entries.map(readItem));

    const added = [];
    const lost = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { added.push(r.value); return; }
      console.error('could not read a picked file', r.reason);
      lost.push(nameOf(entries[i]));
    });
    pending = pending.concat(added);

    reading -= entries.length;
    renderThumbs();
    applyInferredDate();
    syncSaveState();

    if (lost.length) {
      saveError.textContent = readFailureMessage(lost, entries.length);
      saveError.hidden = false;
    }
  });

  // ── Sheet interactions ───────────────────────────────────────────
  caption.addEventListener('input', syncSaveState);

  // Programmatic assignment fires no input event, so this only ever hears a real parent —
  // which is what makes it safe to treat as final.
  date.addEventListener('input', () => {
    dateChosenByHand = true;
    dateNote.hidden = true;
    markChosen();
  });

  isMilestone.addEventListener('change', () => {
    milestoneTitle.hidden = !isMilestone.checked;
    if (isMilestone.checked) milestoneTitle.focus();
  });

  cancelBtn.addEventListener('click', close);
  // ESC dismisses a native <dialog> without firing our handlers — clean up regardless.
  sheet.addEventListener('close', releasePending);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // NOT `title` — that is the sheet's heading element in the enclosing scope, and
    // shadowing it here meant a later `title.textContent = ...` wrote to a string.
    const milestoneName = milestoneTitle.value.trim();
    const draft = {
      memoryDate: date.value || todayISO(),
      caption: caption.value.trim() || null,
      milestone: isMilestone.checked
        ? { isMilestone: true, title: milestoneName || 'Milestone' }
        : null,
      photos: pending,
    };

    // Uploading takes a moment on a phone; say so rather than letting the sheet sit
    // there looking ignored, and block a second submit.
    const target = editing;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    saveBtn.classList.add('is-busy');
    try {
      const post = target
        ? await updatePost(target.id, draft, target.author || author)
        : await createPost(draft, author);

      // The post itself is written either way, so the timeline is told about it either
      // way — a memory that saved with eight of ten photos is still a memory, and hiding
      // it until the rest arrive would be worse.
      (target ? onUpdate : onCreate)(post);

      const lost = post.failedPhotos || [];
      if (lost.length) {
        // The sheet STAYS OPEN, holding the photos that did not make it. Their files exist
        // nowhere else — closing here is what turned a flaky connection into six lost
        // photos and a cheerful "saved". Pressing Save again now edits the post that was
        // just created and uploads only what is missing.
        editing = post;
        title.textContent = 'Edit memory';
        deleteBtn.hidden = false;
        pending = [...storedAsPending(post), ...lost.map((f) => f.photo)];
        const n = lost.length;
        saveError.textContent = `${n} photo${n === 1 ? '' : 's'} did not upload — the rest `
          + 'of the memory saved. They are still here: press Save to try again.';
        saveError.hidden = false;
        renderThumbs();
        return; // deliberately not closing
      }

      pending = []; // the saved post owns the previews now
      saveError.hidden = true;
      sheet.close();
    } catch (err) {
      console.error(err);
      saveError.textContent = 'Could not save that memory. It is still here — try again.';
      saveError.hidden = false;
    } finally {
      saveBtn.textContent = 'Save';
      saveBtn.classList.remove('is-busy');
      syncSaveState();
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!editing) return;
    // Photos cascade with the post and there is no trash to fish them back out of.
    if (!confirm('Delete this memory? Its photos go with it, and this cannot be undone.')) {
      return;
    }
    const target = editing;
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting…';
    try {
      await deletePost(target.id);
      sheet.close();
      onDelete(target.id);
    } catch (err) {
      console.error(err);
      saveError.textContent = 'Could not delete that memory — try again.';
      saveError.hidden = false;
    } finally {
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Delete this memory';
    }
  });
}
