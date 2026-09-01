// Running an enhancement that must never take the app down with it.
//
// THE LESSON, paid for once. init() is a straight line: sign in, read config, start the
// notification bell, wire the compose button, bind the timeline. A throw anywhere in it
// abandons everything after it AND rejects init(), so a fault in the bell — the most
// optional thing on the page — presented as a scrapbook that would not load and an add
// button that did nothing. Two symptoms, one line, and neither pointed at notifications.
//
// The distinction this encodes: some startup steps are LOAD-BEARING and some are
// ENHANCEMENTS. Signing in and wiring compose are the app. A bell, an install prompt, a
// share handler are things that make it nicer and whose absence is survivable. An
// enhancement that fails should cost exactly itself.
//
// Not a blanket try/catch over init(): that would hide a broken timeline just as
// eagerly. Each enhancement is named and wrapped on purpose, so what is allowed to fail
// quietly is a decision written down rather than a side effect.

/**
 * Run an enhancement, containing any failure to itself.
 *
 * Handles both shapes, because the difference is invisible at the call site and easy to
 * get wrong: a synchronous throw, and a returned promise that rejects later.
 *
 * @param {string} name what failed, for the console
 * @param {() => unknown} start the enhancement
 * @returns {unknown} whatever it returned, or null if it failed
 */
export function optional(name, start) {
  try {
    const result = start();
    // An async enhancement fails after this function has already returned. Unhandled, it
    // surfaces as an unhandled rejection and — depending on the browser — nothing else.
    if (result && typeof result.then === 'function') {
      return result.catch((err) => {
        report(name, err);
        return null;
      });
    }
    return result;
  } catch (err) {
    report(name, err);
    return null;
  }
}

function report(name, err) {
  // Loud in the console, silent on the page. Someone opening devtools should find out
  // immediately; a parent looking at photos should not be told the bell is unwell.
  console.error(`[optional] "${name}" failed and was skipped — the app continues.`, err);
}
