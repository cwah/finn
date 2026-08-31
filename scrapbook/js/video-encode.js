// Making a phone video small enough to live in a scrapbook.
//
// Two copies are kept of every clip, for the same reason a darkroom keeps a negative and
// a print:
//
//   the ORIGINAL   whatever came off the phone, untouched. Uploaded in the background
//                  after the memory is safe, because it is the slow one and nothing has
//                  to wait for it.
//   the DISPLAY    re-encoded to 1080p H.264, and the one every view actually loads —
//                  the compose strip, the card, the lightbox.
//
// Measured before building this: 17 stored clips came to 157 MB, and two of them —
// 58.8 MB/24s and 46.4 MB/8.8s — were two thirds of that. Phones shoot 4K at around
// 5 MB/s; nothing in this app ever shows more than 1080p.
//
// WHAT IS NOT BAKED IN: the crop and the trim. Both stay non-destructive and applied at
// render, exactly as they are for a photo. That is not only consistency for its own sake
// — a video's POSTER is a photo, and photos are cropped at render, so baking the crop
// into the clip alone would leave the two framed differently on the same card.
//
// The arithmetic lives here, apart from the recorder, because it is the part that can be
// tested. The recorder cannot: it needs the video to play through in real time in a
// FOREGROUND tab, which is a thing a test environment does not have.

/** The long edge a display copy is reduced to. 1080p is more than any view here shows. */
export const VIDEO_EDGE = 1920;

/** Below this there is nothing to gain: the file is already smaller than the encode. */
export const WORTH_ENCODING_BYTES = 3 * 1024 * 1024;

/**
 * Encoding dimensions for a source, as EVEN numbers.
 *
 * H.264 stores chroma at half resolution in each axis, so an odd width or height has no
 * legal representation. Encoders react by rounding, refusing, or producing a file with a
 * green edge — none of which is discovered until playback. Rounding to even here is one
 * line and removes the whole class.
 *
 * @returns {{width: number, height: number, scaled: boolean}}
 */
export function encodeSize(width, height, edge = VIDEO_EDGE) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  if (!w || !h) return { width: 0, height: 0, scaled: false };

  const longest = Math.max(w, h);
  const ratio = longest > edge ? edge / longest : 1;
  // `| 0` after halving, then doubled: floor to the nearest even number, never up — an
  // encoder given more pixels than the source has is being asked to invent them.
  const even = (n) => Math.max(2, Math.floor((n * ratio) / 2) * 2);
  return { width: even(w), height: even(h), scaled: ratio < 1 };
}

/**
 * A bitrate for a given frame size.
 *
 * Bits per pixel per frame rather than a fixed number: a 1080p clip and a 480p one want
 * very different rates, and a single figure would either starve the first or waste bytes
 * on the second. 0.07 is a conservative H.264 figure — visibly clean for the handheld,
 * moderately-lit footage a scrapbook is made of, without paying for detail a phone sensor
 * did not capture in the first place.
 *
 * Clamped at both ends: a floor so a small clip is not smeared, and a ceiling so nothing
 * can ask for more than the storage was sized for.
 */
export function bitrateFor(width, height, fps = 30) {
  const pixels = (Number(width) || 0) * (Number(height) || 0);
  if (!pixels) return 1_000_000;
  const raw = pixels * fps * 0.07;
  return Math.round(Math.min(Math.max(raw, 800_000), 8_000_000));
}

/**
 * Whether a clip is worth re-encoding at all.
 *
 * A small clip re-encoded is a small clip made slightly worse: the saving is not worth a
 * generation of loss, and on a phone it is not worth the wait either, since encoding runs
 * in REAL TIME. A motion photo — a second or two, already tiny — is exactly this case and
 * should always pass straight through.
 */
export function needsEncoding({ width, height, size }) {
  const big = Number(size) > WORTH_ENCODING_BYTES;
  const large = Math.max(Number(width) || 0, Number(height) || 0) > VIDEO_EDGE;
  return Boolean(big || large);
}

/**
 * Roughly how long an encode will take, in seconds.
 *
 * It is real time plus a little, because the recorder consumes frames as the video plays
 * them. Worth being able to say out loud: a parent watching a spinner for twenty seconds
 * with no idea why is a parent who thinks the app has hung.
 */
export function estimateSeconds(duration) {
  const d = Number(duration) || 0;
  return d > 0 ? Math.ceil(d * 1.1) + 1 : 0;
}

// ── The recorder ──────────────────────────────────────────────────
// UNTESTED, and untestable from here: it needs the clip to play through in real time in a
// foreground tab. Three attempts in an automated browser stalled — requestAnimationFrame
// does not fire in a background tab, `play()` never resolves, and one froze the renderer.
// So this half is written to fail SAFELY rather than to be proved correct: every exit
// returns the original file, and a memory is never lost to a failed optimisation.

/** MP4 is the only container worth writing: WebM does not play on every iPhone. */
const MP4_TYPES = [
  'video/mp4;codecs=avc1.42E01E',  // H.264 baseline — the most widely playable there is
  'video/mp4;codecs=avc1',
  'video/mp4',
];

/** The first MP4 flavour this browser will record, or null if it will not record MP4. */
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MP4_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

/**
 * Re-encode a clip to a display copy, or hand back what it was given.
 *
 * NEVER throws. A failure here is a bigger file, which is a disappointment; a failure that
 * propagates is a memory that would not save, which is not. Every path — an unsupported
 * browser, a refused play, a stalled decode — returns `{ file, encoded: false }` and lets
 * the original stand as the display copy too.
 *
 * The audio track is carried across from the source, so a clip that had sound keeps it.
 *
 * @param {File|Blob} file
 * @param {{onProgress?: (fraction: number) => void, signal?: AbortSignal}} opts
 * @returns {Promise<{file: File|Blob, width: number, height: number, encoded: boolean}>}
 */
export async function toDisplayCopy(file, { onProgress, signal } = {}) {
  const give = (f, width = 0, height = 0, encoded = false) => ({ file: f, width, height, encoded });

  const mimeType = pickMimeType();
  if (!mimeType || typeof document === 'undefined') return give(file);

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;          // muted playback is what browsers allow without a gesture
  video.playsInline = true;
  video.preload = 'auto';

  let recorder = null;
  try {
    await once(video, 'loadedmetadata', 20000);

    const size = encodeSize(video.videoWidth, video.videoHeight);
    if (!size.width || !needsEncoding({ width: video.videoWidth, height: video.videoHeight, size: file.size })) {
      return give(file, video.videoWidth, video.videoHeight);
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { alpha: false });

    const stream = canvas.captureStream(30);
    // Sound rides along from the source. captureStream on the element gives the audio
    // track; the canvas only ever carries pictures.
    for (const track of video.captureStream?.()?.getAudioTracks() ?? []) stream.addTrack(track);

    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: bitrateFor(size.width, size.height),
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const finished = once(recorder, 'stop', 30000);
    // Handled here as well as awaited below. If the run is cut short the code returns
    // before the await, and a rejection with nothing listening is an unhandled rejection
    // in a parent's console for a failure that was already dealt with.
    finished.catch(() => {});

    recorder.start();

    // play() is raced, not awaited outright. It is what hung every attempt to test this:
    // in a tab the browser has decided not to run, the promise simply never settles, and
    // an unguarded await here would freeze the compose sheet before the ceiling below has
    // even started counting. Ten seconds is far longer than starting playback can honestly
    // take; past that, the clip goes up as it came.
    const started = await Promise.race([
      video.play().then(() => true, () => false),
      new Promise((res) => setTimeout(() => res(false), 10000)),
    ]);
    if (!started) {
      console.warn('playback would not start, so the clip was not re-encoded');
      return give(file, video.videoWidth, video.videoHeight);
    }

    // Draw until the clip runs out. rAF rather than a timer: it is the only clock that
    // matches the compositor, and a timer would drop or duplicate frames against it.
    // A HARD CEILING on the draw loop. Playback can stall — a backgrounded tab, a decoder
    // that gives up — and `ended` then never arrives. Without this the compose sheet would
    // sit at "Shrinking the video…" for the rest of the session with no way out.
    //
    // Generous, because the loop is real-time by nature and a slow phone is not a stall:
    // three times the clip's length plus ten seconds.
    const ceiling = Math.max(15000, (video.duration || 0) * 3000 + 10000);
    const ranOut = await new Promise((resolve) => {
      let stopped = false;
      const end = (timedOut) => () => { if (!stopped) { stopped = true; resolve(Boolean(timedOut)); } };
      const timer = setTimeout(end(true), ceiling);
      const finish = () => { clearTimeout(timer); end(false)(); };
      signal?.addEventListener('abort', finish, { once: true });
      video.addEventListener('ended', finish, { once: true });
      video.addEventListener('error', finish, { once: true });
      const draw = () => {
        if (stopped) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (video.duration) onProgress?.(Math.min(1, video.currentTime / video.duration));
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });

    // A run that was cut short has recorded PART of the clip, and a memory that stops
    // halfway is worse than a big one that does not. Give the original back instead.
    if (ranOut) {
      console.warn('re-encoding a clip ran past its time limit; keeping the original');
      return give(file, video.videoWidth, video.videoHeight);
    }

    recorder.stop();
    await finished;

    const out = new Blob(chunks, { type: 'video/mp4' });
    // A result no smaller than the source is not a result. It happens — a clip already
    // efficiently encoded can come out larger — and keeping it would mean paying a
    // generation of quality for more bytes.
    if (!out.size || out.size >= file.size) return give(file, video.videoWidth, video.videoHeight);

    const name = (file.name || 'clip.mp4').replace(/\.[^.]+$/, '') + '.mp4';
    return {
      file: new File([out], name, { type: 'video/mp4', lastModified: file.lastModified }),
      width: size.width,
      height: size.height,
      encoded: true,
    };
  } catch (err) {
    console.warn('could not re-encode that clip; keeping the original', err);
    return give(file, video.videoWidth || 0, video.videoHeight || 0);
  } finally {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* already done */ }
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

/** One event, or a rejection when it never comes. A stalled decode must not hang a save. */
function once(target, type, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timed out`)), ms);
    target.addEventListener(type, () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
