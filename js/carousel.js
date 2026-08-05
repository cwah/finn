// Keeps a carousel's dots in step with the slide you're looking at.
//
// The scrolling itself is pure CSS scroll-snap — this only lights the right dot. Driven
// by an IntersectionObserver rooted on the track rather than a scroll listener, so
// swiping costs nothing per frame, in keeping with the app's performance rules.

/**
 * Wire every carousel inside a freshly mounted card.
 * @param {HTMLElement} root
 */
export function initCarousels(root) {
  for (const carousel of root.querySelectorAll('.carousel')) {
    const track = carousel.querySelector('.carousel-track');
    const slides = [...carousel.querySelectorAll('.carousel-slide')];
    const dots = [...carousel.querySelectorAll('.carousel-dot')];
    if (!track || dots.length !== slides.length) continue;

    dots[0]?.classList.add('is-active');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = slides.indexOf(e.target);
          if (i < 0) continue;
          dots.forEach((d, n) => d.classList.toggle('is-active', n === i));
        }
      },
      // Rooted on the track, so "visible" means "this slide is the one snapped into
      // place" rather than anything to do with the page.
      { root: track, threshold: 0.6 },
    );

    slides.forEach((s) => observer.observe(s));
  }
}
