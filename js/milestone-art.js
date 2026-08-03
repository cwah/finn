// Hand-drawn sketch that backs every milestone card's header band.
//
//   milestoneArt(title) -> SVG markup string
//
// Two subjects, chosen from the title alone — the same "no decisions for the user"
// rule the layout engine follows:
//
//   • a short title  -> baby blocks, one letter per block, spelling it out
//   • anything else  -> balloons
//
// Monochrome by design: every stroke is `currentColor`, so the band's CSS decides the
// hue and the sketch can never drift from the palette.
//
// PURE — no DOM, no fetch, no randomness. The wobble that gives the lines their
// hand-drawn feel is seeded from position, so a given milestone always draws the
// identical sketch instead of shimmering on every re-render.

/** Band the art is drawn into. The viewBox scales; these are just drawing units. */
const W = 560;
const H = 78;

/** Longest title, in letters, that still reads as blocks rather than a wall of cubes. */
const MAX_BLOCKS = 6;

/** Deterministic jitter in roughly [-1, 1] from an integer seed. */
function wobble(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Letters only, uppercased — also what makes the `<text>` below injection-proof. */
function letters(title) {
  return String(title || '').replace(/[^a-z]/gi, '').toUpperCase();
}

/** A square with all four corners nudged off true, so it reads as drawn by hand. */
function blockPath(x, y, size, seed) {
  const j = (i) => wobble(seed * 7 + i) * 1.9;
  const pts = [
    [x + j(1), y + j(2)],
    [x + size + j(3), y + j(4)],
    [x + size + j(5), y + size + j(6)],
    [x + j(7), y + size + j(8)],
  ];
  return `M${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join('L')}Z`;
}

function blocksSvg(chars) {
  const size = 40;
  const gap = 12;
  const total = chars.length * size + (chars.length - 1) * gap;
  const startX = W - total - 26; // right-aligned, clear of the chip on the left
  const y = (H - size) / 2;

  const parts = chars.map((ch, i) => {
    const x = startX + i * (size + gap);
    const tilt = (wobble(i + 1) * 4).toFixed(1);
    const cx = (x + size / 2).toFixed(1);
    const cy = (y + size / 2).toFixed(1);
    return (
      `<g transform="rotate(${tilt} ${cx} ${cy})">` +
      `<path d="${blockPath(x, y, size, i + 1)}"/>` +
      `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" ` +
      `font-size="21" font-weight="700" stroke="none" fill="currentColor">${ch}</text>` +
      `</g>`
    );
  });

  return parts.join('');
}

function balloonsSvg(count = 4) {
  const spacing = 46;
  const startX = W - 26 - (count - 1) * spacing - 15;

  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const cx = startX + i * spacing;
    const r = 13 + wobble(i * 3 + 1) * 1.6;
    const ry = r * 1.2;
    const cy = 20 + wobble(i * 5 + 2) * 3;

    // Body: two mirrored curves meeting at top and bottom, pinched slightly at the base.
    const body =
      `M${cx.toFixed(1)} ${(cy - ry).toFixed(1)}` +
      `C${(cx + r * 1.3).toFixed(1)} ${(cy - ry * 0.6).toFixed(1)} ` +
      `${(cx + r * 1.05).toFixed(1)} ${(cy + ry * 0.7).toFixed(1)} ` +
      `${cx.toFixed(1)} ${(cy + ry).toFixed(1)}` +
      `C${(cx - r * 1.05).toFixed(1)} ${(cy + ry * 0.7).toFixed(1)} ` +
      `${(cx - r * 1.3).toFixed(1)} ${(cy - ry * 0.6).toFixed(1)} ` +
      `${cx.toFixed(1)} ${(cy - ry).toFixed(1)}Z`;

    const knotY = cy + ry;
    const knot = `M${(cx - 3).toFixed(1)} ${knotY.toFixed(1)}L${cx.toFixed(1)} ${(knotY + 5).toFixed(1)}L${(cx + 3).toFixed(1)} ${knotY.toFixed(1)}`;

    const sway = 5 + wobble(i * 11 + 3) * 3;
    const string =
      `M${cx.toFixed(1)} ${(knotY + 5).toFixed(1)}` +
      `q${sway.toFixed(1)} 9 ${(-2).toFixed(1)} 16` +
      `q${(-sway).toFixed(1)} 7 ${(1).toFixed(1)} 13`;

    parts.push(`<path d="${body}"/><path d="${knot}"/><path d="${string}"/>`);
  }
  return parts.join('');
}

/**
 * Build the sketch for a milestone.
 * @param {string} title milestone title, e.g. "First steps"
 * @returns {string} SVG markup, sized to the header band
 */
export function milestoneArt(title) {
  const chars = letters(title);
  const body = chars.length > 0 && chars.length <= MAX_BLOCKS
    ? blocksSvg(chars.split(''))
    : balloonsSvg();

  return (
    `<svg class="milestone-art" viewBox="0 0 ${W} ${H}" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** Which subject a title will draw. Exported so the choice stays testable. */
export function artSubject(title) {
  const n = letters(title).length;
  return n > 0 && n <= MAX_BLOCKS ? 'blocks' : 'balloons';
}
