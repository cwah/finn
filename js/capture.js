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

import { createPost } from './data.js';
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

/**
 * Wire the capture flow.
 * @param {{author: {id: string, name: string}}} options signed-in parent, for attribution
 * @param {(post: object) => void} onCapture called with the SAVED post
 */
export function initCapture({ author }, onCapture) {
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

  let pending = []; // photos measured for the post being composed

  function releasePending() {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
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
        img.style.objectPosition = `${p.focalX * 100}% ${p.focalY * 100}%`;
        cell.append(img);

        if (i === 0) {
          cell.append(Object.assign(document.createElement('span'), {
            className: 'compose-thumb-tag',
            textContent: 'Main',
          }));
        }

        cell.addEventListener('click', () => editPhoto(i));
        return cell;
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

  function open() {
    releasePending();
    renderThumbs();
    saveError.hidden = true;
    caption.value = '';
    date.value = todayISO();
    date.max = todayISO(); // a memory can't have happened tomorrow
    isMilestone.checked = false;
    milestoneTitle.value = '';
    milestoneTitle.hidden = true;
    syncSaveState();
    sheet.showModal();
    caption.focus();
  }

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
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const post = await createPost(draft, author);
      pending = []; // the saved post owns the previews now
      sheet.close();
      onCapture(post);
    } catch (err) {
      console.error(err);
      saveError.textContent = 'Could not save that memory. It is still here — try again.';
      saveError.hidden = false;
    } finally {
      saveBtn.textContent = 'Save';
      syncSaveState();
    }
  });
}
