// Builds DOM for a post. Reads the layout decision from the engine, then constructs
// the matching markup. When adding a layout type, update layout-engine.js, this file,
// and css/cards.css together.

import {
  inferLayout, isMilestone, GRID_MAX, carouselAspect, cropRect, croppedSize, coverAlign,
} from './layout-engine.js';
import { ageStamp, dateLabel } from './age.js';
import { artPreset, milestoneArtSvg } from './milestone-art.js';

function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props);
  return node;
}

function photoEl(photo) {
  const img = el('img', 'card-photo', {
    src: photo.url,
    alt: photo.alt || '',
    loading: 'lazy',
    decoding: 'async',
    width: photo.width,
    height: photo.height,
  });
  return img;
}

/**
 * Wrap a photo so only its crop rectangle shows.
 *
 * `object-fit` cannot express an arbitrary rectangle, so the image is oversized inside an
 * overflow box and offset until the chosen region fills it. Every photo gets the wrapper,
 * cropped or not — an uncropped photo is simply cropped to all of itself, which keeps one
 * code path and one set of CSS rules instead of two that could disagree.
 *
 * @param {object} photo
 * @param {string} group
 * @param {number|null} cellAspect shape of the cell this must cover, or null when the
 *        surrounding frame already matches the crop exactly and no further crop happens
 */
function cropped(photo, group, cellAspect = null) {
  const c = cropRect(photo);
  const size = croppedSize(photo);

  const box = el('div', 'crop-box');
  box.style.setProperty('--cx', c.x);
  box.style.setProperty('--cy', c.y);
  box.style.setProperty('--cw', c.w);
  box.style.setProperty('--ch', c.h);
  // The shape the crop presents, which is what surrounding layout has to reason about.
  box.style.setProperty('--crop-ar', `${size.width} / ${size.height}`);
  // When a cell crops this further, anchor it so the focal point lands as near the
  // cell's centre as covering allows — see coverAlign. Anchoring at the focal fraction
  // itself would merely align it, which is not what choosing a focal point means.
  if (cellAspect) {
    const p = coverAlign(photo, size.width / size.height, cellAspect);
    box.style.setProperty('--px', p.x);
    box.style.setProperty('--py', p.y);
  }

  box.append(makeViewable(photoEl(photo), photo, group));
  return box;
}

/** Make a photo openable full-size. The lightbox reads these off the clicked element. */
function makeViewable(img, photo, group) {
  img.dataset.full = photo.url;
  img.dataset.fullW = photo.width;
  img.dataset.fullH = photo.height;
  img.dataset.group = group;
  return img;
}

/**
 * Age + date + which parent posted it. Quote cards opt out of the author here
 * because they carry their own em-dash attribution as part of the typography.
 */
function metaEl(post, birthDate, { withAuthor = true } = {}) {
  const meta = el('div', 'card-meta');
  meta.append(el('span', 'card-age', { textContent: ageStamp(birthDate, post.memoryDate) }));

  const right = el('div', 'card-meta-right');
  right.append(el('span', 'card-date', { textContent: dateLabel(post.memoryDate) }));
  if (withAuthor && post.author && post.author.name) {
    right.append(el('span', 'card-author', { textContent: post.author.name }));
  }
  meta.append(right);
  return meta;
}

function singlePhotoFrame(photo, group) {
  const frame = el('div', 'photo-frame');
  const size = croppedSize(photo);
  // Reserve space from the CROPPED dimensions, so nothing reflows once the file loads.
  frame.style.setProperty('--ar', `${size.width} / ${size.height}`);

  const box = cropped(photo, group);
  box.classList.add('crop-box--exact'); // the frame already matches the crop's shape
  box.dataset.parallax = 'y';
  frame.append(box);
  return frame;
}

function gridPhotos(photos, group) {
  const wrap = el('div', 'grid-photos');
  photos.slice(0, GRID_MAX).forEach((p) => {
    const cell = el('div', 'grid-cell');
    cell.append(cropped(p, group, 1)); // grid cells are square
    wrap.append(cell);
  });
  return wrap;
}

/**
 * Horizontal, scroll-snapped strip for posts with more photos than a grid can hold.
 * The scrolling is native CSS scroll-snap — no JS drives it, so it costs nothing per
 * frame and keeps momentum feeling right on a phone.
 */
function carouselPhotos(photos, group) {
  const wrap = el('div', 'carousel');
  // One shape for every slide, chosen from the set — see carouselAspect. A fixed shape
  // would cut nearly half off any portrait in a mixed post.
  const slideAspect = carouselAspect(photos);
  wrap.style.setProperty('--slide-ar', slideAspect);

  const track = el('div', 'carousel-track');
  photos.forEach((p) => {
    const slide = el('div', 'carousel-slide');
    slide.append(cropped(p, group, slideAspect));
    track.append(slide);
  });

  const dots = el('div', 'carousel-dots');
  dots.setAttribute('aria-hidden', 'true');
  photos.forEach(() => dots.append(el('span', 'carousel-dot')));

  wrap.append(track, dots);
  return wrap;
}

/** The card itself, for whichever layout the engine picked. */
function buildCard(post, birthDate, type, { canEdit = false } = {}) {
  const card = el('article', `card card--${type}`);

  // Only the parent who wrote a memory gets the affordance to change it. The backend
  // enforces the same rule — this just keeps the button off cards it would fail on.
  if (canEdit) {
    const edit = el('button', 'card-edit', { type: 'button' });
    edit.setAttribute('aria-label', 'Edit this memory');
    edit.dataset.editPost = post.id;
    edit.innerHTML = '&#9998;';
    card.append(edit);
  }

  if (isMilestone(post)) {
    card.classList.add('card--highlight');
    card.append(el('span', 'milestone-badge', {
      textContent: post.milestone.title || 'Milestone',
    }));
  }

  if (type === 'quote') {
    card.append(metaEl(post, birthDate, { withAuthor: false }));
    const q = el('blockquote', null);
    q.append(el('span', 'quote-mark', { textContent: '“' }));
    q.append(el('p', 'quote-text', { textContent: post.caption || '' }));
    card.append(q);
    if (post.author) card.append(el('p', 'card-author', { textContent: `— ${post.author.name}` }));
    return card;
  }

  // Every photo on one post shares a group id, so opening one lets you page the rest.
  const group = post.id;

  if (type === 'grid') {
    card.classList.add(`count-${Math.min(post.photos.length, GRID_MAX)}`);
    card.append(gridPhotos(post.photos, group));
  } else if (type === 'carousel') {
    card.append(carouselPhotos(post.photos, group));
  } else {
    // portrait | landscape
    card.append(singlePhotoFrame(post.photos[0], group));
  }

  card.append(metaEl(post, birthDate));
  if (post.caption) card.append(el('p', 'card-caption', { textContent: post.caption }));
  return card;
}

/**
 * Build a timeline item for a post.
 *
 * Ordinary posts are just the card. A milestone is the card inside a "scene", because
 * its sketch sits out on the page background beside the card — the card clips its own
 * contents (`overflow: hidden` keeps photos inside the corners), so the drawing cannot
 * live inside it and still appear outside its edges. Which side it takes is decided by
 * app.js, which is the only place that knows a milestone's position in the timeline.
 *
 * Whatever comes back is the element the timeline mounts, so it carries memoryDate and
 * the reveal class.
 *
 * @param {object} post
 * @param {string} birthDate ISO birthdate for age computation
 * @param {{currentAuthorId?: string}} [opts] who is signed in, so the card knows whether
 *        to offer editing
 * @returns {HTMLElement|null} null when the post has nothing renderable
 */
export function renderPost(post, birthDate, opts = {}) {
  const type = inferLayout(post);
  if (type === null) return null;

  const canEdit = Boolean(opts.currentAuthorId && post.author?.id === opts.currentAuthorId);
  const card = buildCard(post, birthDate, type, { canEdit });

  if (!isMilestone(post)) {
    card.classList.add('timeline-item');
    card.dataset.memoryDate = post.memoryDate; // lets the timeline order late arrivals
    card.dataset.postId = post.id; // lets an edit find its card again
    return card;
  }

  const scene = el('div', 'milestone-scene timeline-item');
  scene.dataset.memoryDate = post.memoryDate;
  scene.dataset.postId = post.id;

  // The drawing is one of a fixed set — the title only picks which, never what it says,
  // so no parent-typed text reaches the generated markup.
  const preset = artPreset(post.milestone.title || 'Milestone');
  const art = el('div', 'milestone-art-wrap');
  art.setAttribute('aria-hidden', 'true');
  art.dataset.art = preset; // swap point for the real PNGs later
  art.innerHTML = milestoneArtSvg(preset);

  scene.append(art, card);
  return scene;
}
