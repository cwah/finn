// Capture flow. Two entry points from the bottom tray:
//   • the camera button — native hardware capture
//     (<input type="file" accept="image/*" capture="environment">)
//   • the note button — a text-only memory, which the engine turns into a quote card
//
// Either way the chosen content lands in the same compose sheet, where a parent adds
// the caption, the date the moment actually happened, and an optional milestone. The
// sheet is the ONLY place a post is authored — there are no layout choices in it,
// because the engine decides layout from the content alone.
//
// Phase 1 has no backend, so saving builds an in-memory post and hands it back via a
// callback for the timeline to prepend. Photos preview through object URLs.
//
// Phase 2: in the save handler, POST the files to PocketBase and prepend the saved
// record instead of the optimistic one. Nothing else in this module needs to change.

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
 * Wire the bottom-tray capture flow.
 * @param {{author: {id: string, name: string}}} options current parent, for attribution
 * @param {(post: object) => void} onCapture called with the new in-memory post
 */
export function initCapture({ author }, onCapture) {
  const input = document.getElementById('capture');
  const noteBtn = document.getElementById('noteBtn');
  const sheet = document.getElementById('compose');
  const form = document.getElementById('composeForm');
  const thumbs = document.getElementById('composePhotos');
  const caption = document.getElementById('composeCaption');
  const date = document.getElementById('composeDate');
  const isMilestone = document.getElementById('composeMilestone');
  const milestoneTitle = document.getElementById('composeMilestoneTitle');
  const saveBtn = document.getElementById('composeSave');
  const cancelBtn = document.getElementById('composeCancel');

  let pending = []; // photos measured for the post being composed

  function releasePending() {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    pending = [];
  }

  /** Save is live once there is something to show — a photo or a real caption. */
  function syncSaveState() {
    saveBtn.disabled = pending.length === 0 && caption.value.trim() === '';
  }

  function open(photos) {
    pending = photos;
    thumbs.replaceChildren(
      ...photos.map((p) => {
        const img = new Image();
        img.className = 'compose-thumb';
        img.src = p.url;
        img.alt = '';
        return img;
      }),
    );
    thumbs.hidden = photos.length === 0;
    caption.value = '';
    date.value = todayISO();
    date.max = todayISO(); // a memory can't have happened tomorrow
    isMilestone.checked = false;
    milestoneTitle.value = '';
    milestoneTitle.hidden = true;
    syncSaveState();
    sheet.showModal();
    if (photos.length === 0) caption.focus();
  }

  function close() {
    releasePending();
    if (sheet.open) sheet.close();
  }

  // ── Entry points ─────────────────────────────────────────────────
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = ''; // allow re-capturing the same file
    if (!files.length) return;
    try {
      const photos = await Promise.all(
        files.map(async (f, i) => {
          const { url, width, height } = await measure(f);
          return { id: `local-${Date.now()}-${i}`, url, width, height, alt: null };
        }),
      );
      open(photos);
    } catch (err) {
      console.error(err);
    }
  });

  noteBtn.addEventListener('click', () => open([]));

  // ── Sheet interactions ───────────────────────────────────────────
  caption.addEventListener('input', syncSaveState);

  isMilestone.addEventListener('change', () => {
    milestoneTitle.hidden = !isMilestone.checked;
    if (isMilestone.checked) milestoneTitle.focus();
  });

  cancelBtn.addEventListener('click', close);
  // ESC dismisses a native <dialog> without firing our handlers — clean up regardless.
  sheet.addEventListener('close', releasePending);

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const text = caption.value.trim();
    const milestoneOn = isMilestone.checked;
    const title = milestoneTitle.value.trim();
    const photos = pending;
    pending = []; // hand ownership of the object URLs to the rendered post

    onCapture({
      id: `local-${Date.now()}`,
      memoryDate: date.value || todayISO(),
      createdAt: new Date().toISOString(),
      author,
      caption: text || null,
      milestone: milestoneOn ? { isMilestone: true, title: title || 'Milestone' } : null,
      photos,
    });

    sheet.close();
  });
}
