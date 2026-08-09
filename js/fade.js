// How close a card is to being the thing you are looking at.
//
// Drives the milestone artwork's opacity: it fades up as a card comes into view, is
// clearest when the card owns the screen, and fades away as the card leaves. The artwork
// itself never moves — the fade IS the animation.
//
// PURE, so the curve can be checked without a browser. app.js calls it once per scroll
// frame for the handful of cards actually on screen.

/**
 * @param {number} top    the element's top edge, relative to the viewport
 * @param {number} height the element's height
 * @param {number} viewportHeight
 * @returns {number} 0 while entering or leaving, 1 when centred, eased at both ends
 */
export function centreProgress(top, height, viewportHeight) {
  if (!(viewportHeight > 0) || !(height >= 0)) return 0;

  // How far the element's middle sits from the viewport's, as a fraction of the distance
  // it travels between first appearing and fully leaving: 1 entering the bottom,
  // 0 centred, -1 leaving the top.
  const travel = (viewportHeight + height) / 2;
  const offset = (top + height / 2 - viewportHeight / 2) / travel;

  const t = Math.max(0, 1 - Math.abs(offset));
  // Smoothstep: eases in and out instead of ramping linearly, so the artwork does not
  // appear to snap on at the edges of the viewport.
  return t * t * (3 - 2 * t);
}
