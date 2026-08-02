// Builds DOM for a post. Reads the layout decision from the engine, then constructs
// the matching markup. When adding a layout type, update layout-engine.js, this file,
// and css/cards.css together.

import { inferLayout, isMilestone } from './layout-engine.js';
import { ageStamp, dateLabel } from './age.js';

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
  img.dataset.parallax = '';
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

/**
 * Build a fully-rendered post card.
 * @param {object} post
 * @param {string} birthDate ISO birthdate for age computation
 * @returns {HTMLElement|null} null when the post has nothing renderable
 */
export function renderPost(post, birthDate) {
  const type = inferLayout(post);
  if (type === null) return null;

  const card = el('article', `card card--${type}`);
  card.dataset.memoryDate = post.memoryDate; // lets the timeline place late arrivals in order

  if (isMilestone(post)) {
    card.classList.add('card--highlight');
    const title = post.milestone.title || 'Milestone';
    card.append(el('span', 'milestone-badge', { textContent: title }));
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
