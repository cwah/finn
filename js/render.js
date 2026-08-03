// Builds DOM for a post. Reads the layout decision from the engine, then constructs
// the matching markup. When adding a layout type, update layout-engine.js, this file,
// and css/cards.css together.

import { inferLayout, isMilestone } from './layout-engine.js';
import { ageStamp, dateLabel } from './age.js';
import { artPreset, milestoneArtSvg } from './milestone-art.js';

function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props);
  return node;
}

function photoEl(photo) {
  return el('img', 'card-photo', {
    src: photo.url,
    alt: photo.alt || '',
    loading: 'lazy',
    decoding: 'async',
    width: photo.width,
    height: photo.height,
  });
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

function singlePhotoFrame(photo) {
  const frame = el('div', 'photo-frame');
  // Drive aspect-ratio from intrinsic dimensions to reserve space (no reflow on load).
  frame.style.setProperty('--ar', `${photo.width} / ${photo.height}`);
  const img = photoEl(photo);
  img.dataset.parallax = 'y';
  frame.append(img);
  return frame;
}

function gridPhotos(photos) {
  const wrap = el('div', 'grid-photos');
  photos.slice(0, 4).forEach((p) => {
    const cell = el('div', 'grid-cell');
    cell.append(photoEl(p));
    wrap.append(cell);
  });
  return wrap;
}

/** The card itself, for whichever layout the engine picked. */
function buildCard(post, birthDate, type) {
  const card = el('article', `card card--${type}`);

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

  if (type === 'grid') {
    card.classList.add(`count-${Math.min(post.photos.length, 4)}`);
    card.append(gridPhotos(post.photos));
  } else {
    // portrait | landscape
    card.append(singlePhotoFrame(post.photos[0]));
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
 * @returns {HTMLElement|null} null when the post has nothing renderable
 */
export function renderPost(post, birthDate) {
  const type = inferLayout(post);
  if (type === null) return null;

  const card = buildCard(post, birthDate, type);

  if (!isMilestone(post)) {
    card.classList.add('timeline-item');
    card.dataset.memoryDate = post.memoryDate; // lets the timeline order late arrivals
    return card;
  }

  const scene = el('div', 'milestone-scene timeline-item');
  scene.dataset.memoryDate = post.memoryDate;

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
