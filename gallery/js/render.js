// Putting one artwork on the wall.
//
// Not pure — it touches the DOM, and that is all it does. Every decision it renders
// (which frame, what the placard says, what shape the window is) was made by a pure
// module upstream, so this file has no opinions of its own to test.
//
// It UPDATES the markup in index.html rather than rebuilding it. Only one artwork is
// ever on screen, so there is exactly one assembly and exactly one placard for their
// whole life; tearing them down and recreating them on every arrow press would throw
// away the image element that preload.js just warmed, and restart the crossfade from
// nothing.

import { artVars } from './art-fit.js';
import { FRAMES } from './frames.js';
import { baroqueUri } from './baroque-frame.js';
import { fromRoot } from './paths.js';

/** Same tiny builder as scrapbook's render.js. No templating, no innerHTML. */
function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props);
  return node;
}

/**
 * The carved SVG, built once.
 *
 * It is a few kilobytes of string, it never changes, and it is only wanted the first
 * time a baroque-framed piece comes up — so it is built lazily and then kept.
 */
let _baroque = null;
function baroqueImage() {
  if (!_baroque) _baroque = baroqueUri();
  return _baroque;
}

/**
 * Hang an artwork.
 *
 * @param {object} refs elements from index.html, collected once by app.js
 * @param {{artwork: object, frame: string, lines: object, index: number, total: number}} view
 */
export function renderArtwork(refs, view) {
  const { artwork, frame, lines } = view;
  const style = FRAMES[frame] ?? FRAMES.plain;

  refs.artwork.dataset.frame = frame;
  // Unmatted frames still keep the mat element — one code path, never two that could
  // disagree — and collapse it to nothing through this attribute instead.
  refs.artwork.dataset.mat = style.mat ? 'paper' : 'none';

  for (const [name, value] of Object.entries(artVars(artwork?.image))) {
    refs.artwork.style.setProperty(name, value);
  }

  // The carving is only ever generated when a baroque piece is actually shown.
  if (frame === 'baroque') refs.artwork.style.setProperty('--frame-image', baroqueImage());

  // fromRoot leaves an absolute URL alone, so this is correct for both a manifest
  // path and the full /api/files/... URL data-pb.js builds.
  refs.art.src = artwork?.image?.src ? fromRoot(artwork.image.src) : '';
  refs.art.alt = artwork?.alt || artwork?.title || '';
  // Never lazy: this is the one thing on the screen, and lazy would defer the only
  // image the visitor came for.
  refs.art.loading = 'eager';
  refs.art.fetchPriority = 'high';

  renderPlacard(refs.placard, lines);

  refs.status.textContent =
    `Artwork ${view.index + 1} of ${view.total}. ${lines.title}${lines.year ? `, ${lines.year}` : ''}.`;
}

/**
 * The placard's text.
 *
 * Every line is optional. They are skipped entirely rather than rendered empty —
 * an empty element still carries its margin, so a piece with no stated dimensions
 * would otherwise show a mysterious gap where the dimensions used to be.
 */
function renderPlacard(root, lines) {
  root.replaceChildren();

  root.append(el('h1', 'placard-title', { textContent: lines.title }));
  if (lines.artist) root.append(el('p', 'placard-artist', { textContent: lines.artist }));

  const facts = [lines.year, lines.medium, lines.dimensions].filter(Boolean);
  for (const fact of facts) {
    root.append(el('p', 'placard-fact', { textContent: fact }));
  }

  if (lines.note) {
    root.append(el('hr', 'placard-rule'));
    root.append(el('p', 'placard-note', { textContent: lines.note }));
  }
  if (lines.credit) root.append(el('p', 'placard-credit', { textContent: lines.credit }));
}

/**
 * Point the arrows at where they can actually go.
 *
 * aria-disabled, never the disabled attribute: a disabled button that currently has
 * focus drops that focus to <body>, so the visitor's next arrow key goes nowhere and
 * keyboard navigation dies silently at exactly the end of the collection, which is
 * where someone is most likely to be pressing an arrow repeatedly.
 */
export function renderNav(refs, { canOlder, canNewer }) {
  refs.older.setAttribute('aria-disabled', String(!canOlder));
  refs.newer.setAttribute('aria-disabled', String(!canNewer));
}
