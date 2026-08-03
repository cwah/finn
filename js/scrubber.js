// Date scrubber pinned to the right edge, in the spirit of Google Photos: a thin
// track of month ticks you can drag to fly through the timeline, with a bubble
// showing where you are.
//
// Follows the same performance contract as the rest of the app:
//   • every layout READ happens in measure(), called only after a page of posts
//     mounts or on resize — never per scroll frame
//   • every per-frame WRITE is a transform or an opacity, driven from the single
//     rAF loop app.js already runs for parallax
//
// It idles out of sight and fades back in while you scroll, so it never sits on top
// of a memory you are looking at.

const IDLE_MS = 1100;
const PING_MS = 150;

/** "2026-05-12" -> "May" / "May '25" when the year differs from the newest memory. */
function monthLabel(iso, newestYear) {
  const [y, m] = iso.split('-');
  const month = new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString(undefined, { month: 'short' });
  return Number(y) === newestYear ? month : `${month} '${y.slice(2)}`;
}

/**
 * @param {HTMLElement} timeline the mounted card list
 * @returns {{refresh: () => void, update: () => void}}
 */
export function initScrubber(timeline) {
  const root = document.getElementById('scrubber');
  const ticksEl = root.querySelector('.scrubber-ticks');
  const thumb = root.querySelector('.scrubber-thumb');
  const bubble = root.querySelector('.scrubber-bubble');

  let ticks = [];       // { fraction, label } sorted top-to-bottom
  let trackH = 0;
  let scrollable = 1;
  let dragging = false;
  let idleTimer = null;
  let lastLabel = '';

  // update() runs every scroll frame, so resetting the idle timer on each call would
  // churn a timeout 60x a second. Re-arming at most every PING_MS is indistinguishable
  // to the eye and still far more often than IDLE_MS, so the timer never fires early.
  let lastPing = 0;
  function show() {
    root.classList.add('is-active');
    const now = performance.now();
    if (!dragging && now - lastPing < PING_MS) return;
    lastPing = now;
    clearTimeout(idleTimer);
    if (!dragging) idleTimer = setTimeout(() => root.classList.remove('is-active'), IDLE_MS);
  }

  /** All layout reads live here, batched, off the scroll path. */
  function refresh() {
    const doc = document.documentElement;
    scrollable = Math.max(1, doc.scrollHeight - window.innerHeight);
    trackH = root.clientHeight;

    const cards = [...timeline.children].filter((c) => c.dataset.memoryDate);
    if (!cards.length) {
      root.hidden = true;
      return;
    }
    // Nothing to scrub if the whole timeline already fits on screen.
    root.hidden = doc.scrollHeight <= window.innerHeight + 40;

    const newestYear = Number(cards[0].dataset.memoryDate.slice(0, 4));
    const seen = new Set();
    ticks = [];
    for (const card of cards) {
      const key = card.dataset.memoryDate.slice(0, 7); // YYYY-MM
      if (seen.has(key)) continue;
      seen.add(key);
      ticks.push({
        fraction: Math.min(1, Math.max(0, card.offsetTop / scrollable)),
        label: monthLabel(card.dataset.memoryDate, newestYear),
      });
    }

    ticksEl.replaceChildren(
      ...ticks.map(({ fraction, label }) => {
        const tick = document.createElement('span');
        tick.className = 'scrubber-tick';
        tick.style.top = `${fraction * 100}%`;
        tick.textContent = label;
        return tick;
      }),
    );
    update();
  }

  /** Per-frame writes only: one transform, and text when the month actually changes. */
  function update() {
    if (root.hidden) return;
    const fraction = Math.min(1, Math.max(0, window.scrollY / scrollable));
    thumb.style.transform = `translate3d(0, ${fraction * trackH}px, 0)`;
    bubble.style.transform = `translate3d(0, ${fraction * trackH}px, 0)`;

    let label = ticks.length ? ticks[0].label : '';
    for (const t of ticks) {
      if (t.fraction <= fraction) label = t.label;
    }
    if (label !== lastLabel) {
      bubble.textContent = label;
      lastLabel = label;
    }
    show();
  }

  // ── Drag to scrub ────────────────────────────────────────────────
  function scrollToPointer(clientY) {
    const rect = root.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    window.scrollTo({ top: fraction * scrollable });
  }

  root.addEventListener('pointerdown', (e) => {
    dragging = true;
    root.classList.add('is-active', 'is-dragging');
    root.setPointerCapture(e.pointerId);
    scrollToPointer(e.clientY);
    e.preventDefault(); // keep the gesture from turning into a page scroll
  });

  root.addEventListener('pointermove', (e) => {
    if (dragging) scrollToPointer(e.clientY);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('is-dragging');
    if (root.hasPointerCapture?.(e.pointerId)) root.releasePointerCapture(e.pointerId);
    show();
  }
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  // Re-measure on resize, batched into a frame so it can't thrash.
  let resizePending = false;
  window.addEventListener('resize', () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      refresh();
      resizePending = false;
    });
  }, { passive: true });

  return { refresh, update };
}
