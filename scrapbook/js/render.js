// Builds DOM for a post. Reads the layout decision from the engine, then constructs
// the matching markup. When adding a layout type, update layout-engine.js, this file,
// and css/cards.css together.

import {
  inferLayout, isMilestone, GRID_MAX, leadAspect, cropRect, croppedSize, coverAlign,
  rotationOf, orientedSize, trimRange, hasVideo, isMotion, lightFilter,
} from './layout-engine.js';
import { ageStamp, dateLabel } from './age.js';
import { milestoneArtSvg, artImage } from './milestone-art.js';

function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props);
  return node;
}

/**
 * The picture itself — a still, or the poster frame of something that moves.
 *
 * A video's poster IS a photo, which is literally true of a motion photo and true by
 * construction of a video, whose poster is grabbed at upload. So this is the only place
 * that knows the difference: the crop box, the engine and every layout rule above it go
 * on reasoning about stored width/height and never learn that motion exists.
 */
function photoEl(photo) {
  // Set on the MEDIA, not on the rotor or the crop box: those carry transforms and
  // overflow, and a filter on either would make a new containing block for them.
  const light = lightFilter(photo);

  if (!hasVideo(photo)) {
    const img = el('img', 'card-photo rotor-media', {
      // The card's own size, not the original. `url` is what the lightbox opens.
      src: photo.cardUrl || photo.url,
      alt: photo.alt || '',
      loading: 'lazy',
      decoding: 'async',
      width: photo.width,
      height: photo.height,
    });
    if (light) img.style.filter = light;
    return img;
  }

  const { start, end } = trimRange(photo.video);
  const motion = isMotion(photo);
  // The media fragment asks the browser for just the trimmed stretch, so a 3-minute
  // source does not download in full to play four seconds of it.
  const video = el('video', 'card-photo card-video rotor-media', {
    poster: photo.cardUrl || photo.url,
    // 'metadata' either way: with 'none' the first tap on the badge has nothing buffered
    // and stalls on a blank frame. Metadata is a few KB and buys an instant start.
    preload: 'metadata',
    muted: true,
    loop: motion,
    playsInline: true,
    // Controls belong to the lightbox; a card is a thumbnail, not a player.
    controls: false,
    width: photo.width,
    height: photo.height,
  });
  video.src = `${photo.video.url}#t=${start.toFixed(2)},${end.toFixed(2)}`;
  // muted must be set as an attribute too, or autoplay is refused on some browsers.
  video.setAttribute('muted', '');
  // A clip's poster is the same picture as its frames, so both take the same light.
  if (light) video.style.filter = light;
  video.dataset.motion = motion ? 'true' : 'false';
  video.dataset.trimStart = start;
  video.dataset.trimEnd = end;
  return video;
}

/**
 * Turn the media upright inside the crop box.
 *
 * A CSS transform does not change an element's layout box, so rotating the media alone
 * would leave the crop box measuring the shape it used to be. The rotor is the layout box
 * instead: it takes the ORIENTED aspect ratio, which is exactly what the media's own
 * intrinsic ratio used to supply, and the media is turned inside it.
 *
 * Every photo gets one, turned or not — one code path rather than two that could
 * disagree, the same reason every photo gets a crop box.
 */
function rotor(photo, media) {
  const deg = rotationOf(photo);
  const o = orientedSize(photo);
  const wrap = el('div', 'rotor');
  wrap.style.setProperty('--rot', deg);
  // Unitless, because it is used in calc() as a number as well as in aspect-ratio.
  wrap.style.setProperty('--oar', o.width / o.height);
  wrap.style.aspectRatio = `${o.width} / ${o.height}`;
  // A quarter turn swaps the axes, so the media is laid out across the rotor's other
  // dimension before being turned into place.
  if (deg % 180 !== 0) wrap.classList.add('is-quarter');
  wrap.append(media);
  return wrap;
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

  const media = photoEl(photo);
  box.append(rotor(photo, media));
  makeViewable(media, photo, group);
  return box;
}

/** Seconds as a clock, for the badge: 8 -> 0:08, 95 -> 1:35. */
function clock(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Mount a photo into the frame, cell or slide that holds it, with whatever the medium
 * needs alongside — a duration badge for a video, nothing at all for a still.
 *
 * The badge is a sibling of the crop box rather than a child, because the box is
 * deliberately oversized and offset to show its crop: anything inside it would be
 * positioned against the picture rather than against the cell the parent can see.
 */
function mountMedia(container, photo, group, cellAspect = null) {
  const box = cropped(photo, group, cellAspect);
  container.append(box);

  if (isMotion(photo)) {
    // A motion photo carries no duration — it is a moment, and the number would be noise.
    // What it does need is a way to STOP: the loop is already running, and until now the
    // only thing a photo offered was "expand". Kept out of sight until pointed at.
    const badge = el('button', 'video-badge video-badge--motion is-playing', { type: 'button' });
    badge.setAttribute('aria-label', 'Pause this motion photo');
    container.append(badge);
  } else if (hasVideo(photo)) {
    // A video waits to be asked, and the badge IS the ask — it plays the clip in place.
    // Tapping the picture still expands it, so both remain available.
    const length = clock(trimRange(photo.video).duration);
    const badge = el('button', 'video-badge', { type: 'button', textContent: length });
    badge.dataset.length = length;
    badge.setAttribute('aria-label', `Play, ${length}`);
    container.append(badge);
  }
  return box;
}

/** Make a photo openable full-size. The lightbox reads these off the clicked element. */
function makeViewable(img, photo, group) {
  const c = cropRect(photo);
  const o = orientedSize(photo);
  img.dataset.full = photo.url;
  // The size the picture PRESENTS, so the lightbox sizes a turned photo correctly.
  img.dataset.fullW = o.width;
  img.dataset.fullH = o.height;
  // The crop travels with it: opening a photo should show the picture that was framed,
  // not the file it was framed from. So does the rotation, for the same reason.
  img.dataset.crop = `${c.x} ${c.y} ${c.w} ${c.h}`;
  img.dataset.rotation = rotationOf(photo);
  // Travels with the crop and the rotation, for the same reason: opening a photo should
  // show the picture that was framed, not the file it was framed from.
  const light = lightFilter(photo);
  if (light) img.dataset.light = light;
  if (hasVideo(photo)) {
    const { start, end } = trimRange(photo.video);
    img.dataset.video = photo.video.url;
    img.dataset.trim = `${start} ${end}`;
  }
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

  const box = mountMedia(frame, photo, group);
  box.classList.add('crop-box--exact'); // the frame already matches the crop's shape
  box.dataset.parallax = 'y';
  return frame;
}

function gridPhotos(photos, group) {
  const wrap = el('div', 'grid-photos');
  const shown = photos.slice(0, GRID_MAX);

  // In a three-photo grid the first cell spans the full width, and it is the one place
  // in a grid where a single photo sets the shape — so it follows the lead photo's crop
  // instead of being square like the rest.
  const heroAspect = shown.length === 3 ? leadAspect(shown) : null;
  if (heroAspect) wrap.style.setProperty('--hero-ar', heroAspect);

  shown.forEach((p, i) => {
    const cell = el('div', 'grid-cell');
    const isHero = heroAspect !== null && i === 0;
    mountMedia(cell, p, group, isHero ? heroAspect : 1); // other cells are square
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
  // One shape for every slide — the card's height cannot jump as you swipe — taken from
  // the lead photo, so cropping it reshapes the strip. See leadAspect.
  const slideAspect = leadAspect(photos);
  wrap.style.setProperty('--slide-ar', slideAspect);

  const track = el('div', 'carousel-track');
  photos.forEach((p) => {
    const slide = el('div', 'carousel-slide');
    mountMedia(slide, p, group, slideAspect);
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

  // The drawing depends on this milestone's NEIGHBOURS, not just its own title — nothing
  // repeats back to back — so it is filled in by app.js once the timeline order is known.
  // The title rides along so the choice can be recomputed when the order changes.
  scene.dataset.milestoneTitle = post.milestone.title || 'Milestone';
  const art = el('div', 'milestone-art-wrap');
  art.setAttribute('aria-hidden', 'true');

  scene.append(art, card);
  return scene;
}

/**
 * Fill a milestone's artwork holder with a given drawing. Separate from building the
 * scene because the choice is a property of the whole timeline, and re-runs when it
 * changes.
 *
 * @param {HTMLElement} wrap the `.milestone-art-wrap`
 * @param {string} preset
 */
export function setMilestoneArt(wrap, preset) {
  if (wrap.dataset.art === preset) return; // already showing this one
  wrap.dataset.art = preset;

  const image = artImage(preset);
  if (image) {
    // Real artwork, applied as a mask so it takes the palette colour rather than
    // arriving as whatever black the file happens to contain.
    wrap.style.setProperty('--art-ar', `${image.width} / ${image.height}`);
    const layer = el('div', 'milestone-art milestone-art--image');
    // Absolute, because a relative URL inside a custom property resolves against the
    // STYLESHEET that uses it — cards.css — and would look for it under css/.
    layer.style.setProperty('--art-src', `url("${new URL(image.src, document.baseURI).href}")`);
    wrap.replaceChildren(layer);
  } else {
    wrap.style.setProperty('--art-ar', '1'); // the placeholders are drawn square
    wrap.innerHTML = milestoneArtSvg(preset);
  }
}
