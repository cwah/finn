// Capture flow. ONE entry point: the floating + opens the compose sheet, and photos are
// attached from inside it via the native camera/picker
// (<input type="file" accept="image/*" capture="environment">).
//
// That keeps a single door for every kind of memory — attach photos or don't, and the
// engine decides what the post becomes. A sheet saved with no photos and a caption
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
import { openPhotoEditor } from './photo-editor.js';

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

/** Opens the sheet on an existing post. Set by initCapture; used by app.js. */
export let openForEdit = () => {};

/**
 * Wire the compose sheet, which both creates and edits.
 *
 * One sheet for both on purpose: a separate edit form would be a second authoring
 * surface to keep in step, and every field means the same thing in both directions.
 *
 * @param {{author: {id: string, name: string}}} options signed-in parent, for attribution
 * @param {{onCreate: (post) => void, onUpdate: (post) => void, onDelete: (id) => void}} handlers
 */
export function initCapture({ author }, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  const input = document.getElementById('capture');
  const composeBtn = document.getElementById('composeBtn');
  const addLabel = document.getElementById('composeAddLabel');
  const sheet = document.getElementById('compose');
  const form = document.getElementById('composeForm');
  const thumbs = document.getElementById('composePhotos');
  const caption = document.getElementById('composeCaption');
  const date = document.getElementById('composeDate');
  const isMilestone = document.getElementById('composeMilestone');
  const milestoneTitle = document.getElementById('composeMilestoneTitle');
  const saveBtn = document.getElementById('composeSave');
  const cancelBtn = document.getElementById('composeCancel');
  const saveError = document.getElementById('composeError');
  const title = document.getElementById('composeTitle');
  const deleteBtn = document.getElementById('composeDelete');

  let pending = []; // photos on the post being composed
  let editing = null; // the post being edited, or null when composing a new one

  /**
   * Only object URLs belong to us — those are previews of files picked in this session.
   * A photo already stored on the server has an https URL and must not be revoked.
   */
  function releasePending() {
    pending.forEach((p) => { if (p.file) URL.revokeObjectURL(p.url); });
    pending = [];
  }

  /** Save is live once there is something to show — a photo or a real caption. */
  function syncSaveState() {
    saveBtn.disabled = pending.length === 0 && caption.value.trim() === '';
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
          syncSaveState();
        });

        const wrap = document.createElement('div');
        wrap.className = 'compose-thumb-wrap';
        wrap.append(cell, drop);
        return wrap;
      }),
    );
    thumbs.hidden = pending.length === 0;
    addLabel.textContent = pending.length ? 'Add more photos' : 'Add photos';
  }

  /** Reframe a photo, or promote it to lead the post. */
  async function editPhoto(i) {
    const result = await openPhotoEditor(pending[i], { isMain: i === 0 });
    if (!result) return;

    pending[i] = { ...pending[i], focalX: result.focalX, focalY: result.focalY };
    if (result.makeMain && i !== 0) {
      // Promotion is a reorder, so it survives straight through as photo order — the
      // renderer and the backend both already treat position 0 as the lead.
      const [chosen] = pending.splice(i, 1);
      pending.unshift(chosen);
    }
    renderThumbs();
  }

  /**
   * Open the sheet. With a post, it edits that post; without, it composes a new one.
   * @param {object|null} post
   */
  function open(post = null) {
    releasePending();
    editing = post;

    if (post) {
      // Existing photos carry an id and a server URL, so the data layer knows to patch
      // them in place rather than re-uploading a file it already has.
      pending = post.photos.map((p) => ({
        id: p.id,
        url: p.url,
        width: p.width,
        height: p.height,
        focalX: p.focalX,
        focalY: p.focalY,
      }));
    }

    title.textContent = post ? 'Edit memory' : 'New memory';
    deleteBtn.hidden = !post;
    saveError.hidden = true;
    caption.value = post?.caption || '';
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

  openForEdit = open;

  function close() {
    releasePending();
    if (sheet.open) sheet.close();
  }

  // ── The single entry point ───────────────────────────────────────
  composeBtn.addEventListener('click', () => open());

  // Photos arrive from inside the open sheet, so they ADD to what is already pending
  // rather than starting a new post.
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = ''; // allow re-picking the same file
    if (!files.length) return;
    try {
      const added = await Promise.all(
        files.map(async (f) => {
          // Keep the File alongside its measurements: the preview needs the object URL,
          // and the upload needs the File itself. The focal point is picked from the
          // image's own content here, once, rather than on every render.
          const [{ url, width, height }, focal] = await Promise.all([
            measure(f),
            detectFocalPoint(f),
          ]);
          return { file: f, url, width, height, focalX: focal.x, focalY: focal.y };
        }),
      );
      pending = pending.concat(added);
      renderThumbs();
      syncSaveState();
    } catch (err) {
      console.error(err);
    }
  });

  // ── Sheet interactions ───────────────────────────────────────────
  caption.addEventListener('input', syncSaveState);

  isMilestone.addEventListener('change', () => {
    milestoneTitle.hidden = !isMilestone.checked;
    if (isMilestone.checked) milestoneTitle.focus();
  });

  cancelBtn.addEventListener('click', close);
  // ESC dismisses a native <dialog> without firing our handlers — clean up regardless.
  sheet.addEventListener('close', releasePending);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = milestoneTitle.value.trim();
    const draft = {
      memoryDate: date.value || todayISO(),
      caption: caption.value.trim() || null,
      milestone: isMilestone.checked
        ? { isMilestone: true, title: title || 'Milestone' }
        : null,
      photos: pending,
    };

    // Uploading takes a moment on a phone; say so rather than letting the sheet sit
    // there looking ignored, and block a second submit.
    const target = editing;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const post = target
        ? await updatePost(target.id, draft, target.author || author)
        : await createPost(draft, author);
      pending = []; // the saved post owns the previews now
      sheet.close();
      (target ? onUpdate : onCreate)(post);
    } catch (err) {
      console.error(err);
      saveError.textContent = 'Could not save that memory. It is still here — try again.';
      saveError.hidden = false;
    } finally {
      saveBtn.textContent = 'Save';
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
