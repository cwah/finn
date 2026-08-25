// Adding a drawing: sign in, straighten it, write the label, hang it.
//
// Not pure, and deliberately thin. Every rule with arithmetic in it is in js/bake.js
// and every rule about what a label says is in js/placard.js — both tested. What is
// left here is wiring, and one job worth naming: the display copy is baked in the
// browser and BOTH files are uploaded, the corrected one and the untouched original.
//
// Framing is never destruction. The original is kept whole so any crop, angle or
// adjustment can be redone years from now; the recipe is stored beside it so the editor
// can be reopened exactly where it was left.

import { signIn, signOut, currentSession, authed, birthDate } from './admin/auth.js';
import { getGallery } from './data.js';
import { loadImage, paintPreview, bakeDisplay } from './admin/bake-canvas.js';
import { initCropBox } from './admin/crop-box.js';
import { largestInscribedCrop, cropIsCovered, recipe, usableAngle } from './bake.js';
import { monthsAt, ageLabel } from './placard.js';

const PREVIEW_MAX = 900;
/** Under this many characters, a note is a fragment and is offered to the model. */
const THIN_NOTE = 40;

const el = (sel) => document.querySelector(sel);
const at = (name) => document.querySelector(`[data-el="${name}"]`);
const field = (name) => document.querySelector(`[data-f="${name}"]`);

const gate = el('.gate');
const studio = el('.studio');

const state = {
  file: null,
  image: null,
  angle: 0,
  brightness: 1,
  contrast: 1,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  birthDate: null,
};

let cropBox = null;

// ── Sign in ─────────────────────────────────────────────────────────────────
function showStudio(show) {
  gate.hidden = show;
  studio.hidden = !show;
}

el('.gate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = el('.gate-error');
  error.hidden = true;
  try {
    await signIn(form.identity.value.trim(), form.password.value);
    form.reset();
    await start();
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  }
});

document.querySelector('[data-act="sign-out"]').addEventListener('click', () => {
  signOut();
  showStudio(false);
});

async function start() {
  showStudio(true);
  // Read once, while signed in. It never reaches the public API — see auth.js.
  state.birthDate = await birthDate();
  updateAgePreview();
  await refreshHung();
}

/**
 * List what is on the wall, with a way to take your own drawings off it.
 *
 * Deleting lives here rather than on the wall on purpose: the gallery is a gallery, and
 * management chrome that exists for one person does not belong on it. Somebody else's
 * drawing is listed but has no delete — which is what the collection rule enforces
 * anyway, so the interface simply agrees with the server instead of inviting a refusal.
 */
async function refreshHung() {
  const list = at('hung');
  const note = at('hung-note');
  if (!list) return;

  try {
    const { artworks } = await getGallery();
    const me = currentSession()?.id ?? null;
    list.replaceChildren();

    if (artworks.length === 0) {
      note.textContent = 'Nothing is hanging yet.';
      return;
    }
    note.textContent = '';

    for (const artwork of artworks) {
      const mine = Boolean(me) && artwork.authorId === me;
      const item = document.createElement('li');
      item.className = 'hung-item';
      item.dataset.mine = String(mine);

      const thumb = document.createElement('img');
      thumb.className = 'hung-thumb';
      thumb.src = artwork.image.src;
      thumb.alt = '';
      thumb.loading = 'lazy';

      const text = document.createElement('div');
      text.className = 'hung-text';
      const title = document.createElement('strong');
      title.className = 'hung-title';
      title.textContent = artwork.title;
      const meta = document.createElement('span');
      meta.className = 'hung-meta';
      meta.textContent = mine
        ? artwork.createdOn
        : `${artwork.createdOn} · added by someone else`;
      text.append(title, meta);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'hung-delete';
      remove.textContent = 'Delete';
      // Two presses, not a confirm() dialog: a browser modal blocks everything and is
      // easy to dismiss by reflex. Arming the button in place is harder to do by accident
      // and cheaper to back out of.
      remove.addEventListener('click', async () => {
        if (remove.dataset.confirm !== 'true') {
          remove.dataset.confirm = 'true';
          remove.textContent = 'Really delete?';
          setTimeout(() => {
            delete remove.dataset.confirm;
            remove.textContent = 'Delete';
          }, 4000);
          return;
        }
        remove.disabled = true;
        try {
          const res = await authed(`/api/collections/gallery_artworks/records/${artwork.id}`,
            { method: 'DELETE' });
          if (!res.ok) throw new Error(`The gallery refused that (${res.status}).`);
          await refreshHung();
        } catch (problem) {
          remove.disabled = false;
          note.textContent = problem.message;
        }
      });

      item.append(thumb, text, remove);
      list.append(item);
    }
  } catch (problem) {
    note.textContent = `Could not list what is hanging: ${problem.message}`;
  }
}

/**
 * Show the artist line the placard will carry.
 *
 * The age is worked out here and stored on the drawing, so a failure to read the birth
 * date is otherwise completely silent — the save succeeds and the label just quietly
 * says nothing, or worse says "age 0". Putting it on screen next to the date makes a
 * wrong answer visible while it can still be fixed.
 */
function updateAgePreview() {
  const hint = at('age-preview');
  if (!hint) return;
  const createdOn = field('createdOn').value;
  if (!state.birthDate) {
    hint.textContent = 'No birth date available, so the label will carry no age.';
    hint.dataset.warn = 'true';
    return;
  }
  if (!createdOn) {
    hint.textContent = '';
    delete hint.dataset.warn;
    return;
  }
  const label = ageLabel(monthsAt(state.birthDate, createdOn));
  hint.textContent = label
    ? `The label will read "Finn, age ${label}".`
    : 'That date is before Finn was born, so the label will carry no age.';
  if (label) delete hint.dataset.warn;
  else hint.dataset.warn = 'true';
}

field('createdOn').addEventListener('input', updateAgePreview);

// ── The photograph ──────────────────────────────────────────────────────────
at('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const image = await loadImage(file);
    state.file = file;
    state.image = image;
    // A fresh photo starts unrotated and uncropped; the moment the angle moves, the
    // default becomes the largest rectangle that is still all photograph.
    state.angle = 0;
    state.crop = { x: 0, y: 0, w: 1, h: 1 };

    at('filename').textContent =
      `${file.name} — ${image.naturalWidth} × ${image.naturalHeight}`;
    el('.editor').hidden = false;
    el('.editor').dataset.mode = 'adjust';
    document.querySelector('[data-act="mode"]').textContent = 'Done adjusting';
    el('.label-form').hidden = false;
    el('.actions').hidden = false;

    if (!cropBox) cropBox = initCropBox(at('crop'), { onChange: onCropChange });
    cropBox.setSource({ width: image.naturalWidth, height: image.naturalHeight, angle: 0 });
    cropBox.setCrop(state.crop);
    redraw();
  } catch (problem) {
    say(problem.message, true);
  }
});

function onCropChange(crop) {
  // No covered/uncovered branch any more: crop-box.js constrains the gesture itself,
  // so an illegal crop is unreachable rather than reported after the fact.
  state.crop = crop;
}

/**
 * Repaint the preview and keep the crop overlay exactly on top of it.
 *
 * While adjusting, this shows the WHOLE rotated frame including the empty corners
 * rotation leaves behind — they are much easier to stay clear of when visible. Once
 * done, it shows the cropped result instead, so the last thing seen before saving is
 * the thing that will actually hang.
 */
function redraw() {
  if (!state.image) return;
  const done = el('.editor').dataset.mode === 'done';
  const size = paintPreview(at('preview'), state.image, {
    width: state.image.naturalWidth,
    height: state.image.naturalHeight,
    angle: state.angle,
    brightness: state.brightness,
    contrast: state.contrast,
  }, PREVIEW_MAX, done ? state.crop : null);

  // The overlay is sized to the canvas rather than the other way round, so a crop
  // fraction is a percentage of the same box the geometry was computed in.
  // Hand CSS the canvas's natural size as a CEILING rather than as a width. Setting
  // `width` in pixels here overflows the panel on a narrow screen — max-inline-size
  // cannot rescue an inline width, and the crop handles end up off the side of the page.
  const stage = at('stage');
  stage.style.setProperty('--nat-w', `${size.width}px`);
  stage.style.aspectRatio = `${size.width} / ${size.height}`;
}

// ── Straighten and adjust ───────────────────────────────────────────────────
at('angle').addEventListener('input', (event) => {
  state.angle = usableAngle(event.target.value);
  at('angle-out').textContent = `${state.angle.toFixed(1)}°`;

  cropBox?.setSource({ angle: state.angle });
  // Rotating leaves empty wedges in the corners. If the crop that was fine a moment ago
  // now reaches into one, pull it back to the largest rectangle that is still covered —
  // silently doing nothing here is how a transparent corner gets baked in.
  if (state.image && !cropIsCovered(state.crop, state.image.naturalWidth,
    state.image.naturalHeight, state.angle)) {
    cropBox?.setCrop(largestInscribedCrop(state.image.naturalWidth,
      state.image.naturalHeight, state.angle));
  }
  redraw();
});

for (const [name, format] of [['brightness', (v) => `${Math.round(v * 100)}%`],
  ['contrast', (v) => `${Math.round(v * 100)}%`]]) {
  at(name).addEventListener('input', (event) => {
    state[name] = Number(event.target.value);
    at(`${name}-out`).textContent = format(state[name]);
    redraw();
  });
}

document.querySelector('[data-act="mode"]').addEventListener('click', (event) => {
  const editor = el('.editor');
  const done = editor.dataset.mode !== 'done';
  editor.dataset.mode = done ? 'done' : 'adjust';
  event.currentTarget.textContent = done ? 'Adjust again' : 'Done adjusting';
  redraw();
});

document.querySelector('[data-act="reset"]').addEventListener('click', () => {
  state.angle = 0;
  state.brightness = 1;
  state.contrast = 1;
  at('angle').value = '0';
  at('brightness').value = '1';
  at('contrast').value = '1';
  at('angle-out').textContent = '0.0°';
  at('brightness-out').textContent = '100%';
  at('contrast-out').textContent = '100%';
  cropBox?.setSource({ angle: 0 });
  cropBox?.setCrop({ x: 0, y: 0, w: 1, h: 1 });
  redraw();
});

// ── The note ────────────────────────────────────────────────────────────────
field('note').addEventListener('input', () => {
  const words = field('note').value.trim();
  at('note-hint').textContent = words.length === 0 || words.length < THIN_NOTE
    ? 'Short or blank — this will be written up in museum style when it is hung.'
    : '';
});

// ── Hang it ─────────────────────────────────────────────────────────────────
function say(message, isError = false) {
  const status = at('status');
  status.textContent = message;
  status.dataset.error = String(isError);
}

document.querySelector('[data-act="save"]').addEventListener('click', async () => {
  if (!state.image || !state.file) return say('Choose a photo first.', true);
  const createdOn = field('createdOn').value;
  if (!createdOn) return say('The drawing needs a date.', true);

  // A drawing without a name is a real thing and museums have a word for it. The
  // schema requires a title, so the fallback happens here rather than being sent empty
  // and refused — placard.js renders the same word for the static path.
  const title = field('title').value.trim() || 'Untitled';

  say('Baking the display copy…');
  try {
    const display = await bakeDisplay(state.image, {
      width: state.image.naturalWidth,
      height: state.image.naturalHeight,
      angle: state.angle,
      crop: state.crop,
      brightness: state.brightness,
      contrast: state.contrast,
    });

    const form = new FormData();
    form.set('title', title);
    form.set('createdOn', createdOn);
    for (const name of ['medium', 'dimensions', 'alt', 'note']) {
      form.set(name, field(name).value.trim());
    }
    // Months, worked out here from a date the public API never sees. Left unset when
    // it cannot be worked out, rather than sent as a zero that would read as an age.
    const months = monthsAt(state.birthDate, createdOn);
    if (months != null && months > 0) form.set('ageMonths', String(months));

    // The dimensions of what will actually hang, so the frame is the right shape before
    // the file has loaded.
    form.set('width', String(display.width));
    form.set('height', String(display.height));
    form.set('adjust', JSON.stringify(recipe(state)));
    // Who added it. The delete rule is `author = @request.auth.id`, so without this a
    // drawing would be removable by nobody but a superuser.
    const me = currentSession()?.id;
    if (me) form.set('author', me);
    form.set('noteSource', field('note').value.trim().length >= THIN_NOTE ? 'human' : 'pending');

    form.set('display', display.blob, `${slug(title)}.jpg`);
    // The untouched photograph, kept so every adjustment above stays undoable.
    form.set('original', state.file, state.file.name);

    say('Hanging it…');
    const res = await authed('/api/collections/gallery_artworks/records',
      { method: 'POST', body: form });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail?.message || `The gallery refused it (${res.status}).`);
    }
    say('Hung. It is now the newest drawing in the collection.');
    resetStudio();
    await refreshHung();
  } catch (problem) {
    say(problem.message, true);
  }
});

/**
 * Back to a clean sheet, after a drawing has been hung.
 *
 * Everything: the photo, the adjustments, the label, the panels. Leaving a saved
 * drawing on screen invites adding it twice — the button stays live and the form still
 * looks like unfinished work rather than finished work.
 *
 * The status line is deliberately NOT cleared. It is the only thing left saying the
 * save worked, and wiping it at the same moment the form empties would make a
 * successful save and a lost one look identical.
 */
function resetStudio() {
  state.file = null;
  state.image = null;
  state.angle = 0;
  state.brightness = 1;
  state.contrast = 1;
  state.crop = { x: 0, y: 0, w: 1, h: 1 };

  at('file').value = '';
  at('filename').textContent = 'Nothing chosen yet.';

  for (const name of ['title', 'createdOn', 'medium', 'dimensions', 'alt', 'note']) {
    field(name).value = '';
  }
  at('note-hint').textContent = '';
  updateAgePreview();

  at('angle').value = '0';
  at('brightness').value = '1';
  at('contrast').value = '1';
  at('angle-out').textContent = '0.0°';
  at('brightness-out').textContent = '100%';
  at('contrast-out').textContent = '100%';

  const editor = el('.editor');
  editor.dataset.mode = 'adjust';
  document.querySelector('[data-act="mode"]').textContent = 'Done adjusting';
  editor.hidden = true;
  el('.label-form').hidden = true;
  el('.actions').hidden = true;

  // The next photo re-initialises the crop box through its own change handler; this
  // only stops the old one holding on to an image that has gone.
  cropBox?.setSource({ width: 1, height: 1, angle: 0 });
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 60) || 'artwork';

// A session that survived a reload goes straight to the studio.
if (currentSession()) start();
else showStudio(false);
