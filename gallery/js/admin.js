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
import { loadImage, paintPreview, bakeDisplay } from './admin/bake-canvas.js';
import { initCropBox } from './admin/crop-box.js';
import { largestInscribedCrop, cropIsCovered, recipe, usableAngle } from './bake.js';
import { ageAt } from './placard.js';

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
}

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

function onCropChange(crop, covered) {
  state.crop = crop;
  at('uncovered').hidden = covered;
}

/** Repaint the preview and keep the crop overlay exactly on top of it. */
function redraw() {
  if (!state.image) return;
  const size = paintPreview(at('preview'), state.image, {
    width: state.image.naturalWidth,
    height: state.image.naturalHeight,
    angle: state.angle,
    brightness: state.brightness,
    contrast: state.contrast,
  }, PREVIEW_MAX);

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

document.querySelector('[data-act="fit"]').addEventListener('click', () => {
  if (!state.image) return;
  cropBox?.setCrop(largestInscribedCrop(state.image.naturalWidth,
    state.image.naturalHeight, state.angle));
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
  const title = field('title').value.trim();
  const createdOn = field('createdOn').value;
  if (!title) return say('The drawing needs a title.', true);
  if (!createdOn) return say('The drawing needs a date.', true);

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
    // Whole years, worked out here from a date the public API never sees.
    const age = ageAt(state.birthDate, createdOn);
    if (age != null) form.set('ageYears', String(age));

    // The dimensions of what will actually hang, so the frame is the right shape before
    // the file has loaded.
    form.set('width', String(display.width));
    form.set('height', String(display.height));
    form.set('adjust', JSON.stringify(recipe(state)));
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
  } catch (problem) {
    say(problem.message, true);
  }
});

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 60) || 'artwork';

// A session that survived a reload goes straight to the studio.
if (currentSession()) start();
else showStudio(false);
