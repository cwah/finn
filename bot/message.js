// Telegram messages -> a post draft, in the shape the JSON contract expects.
//
// PURE: no network, no clock, no Telegram calls. Everything here is decided from the
// message objects alone, so the interesting behaviour — albums, captions, milestone
// tags, which photo size to keep — can be tested without a bot token.
//
// The bot is a second way into the same scrapbook, so it produces the same kind of post
// the compose sheet does. It deliberately does NOT expose layout: the engine still infers
// that from the content, exactly as it does on the web.

/** Marks a post as a milestone. Anything after it on the same line becomes the title. */
const MILESTONE_TAG = /#milestone\b[ \t]*:?[ \t]*([^\n]*)/i;

/** `/start`, `/help@some_bot`. Telegram clients send these constantly. */
const COMMAND = /^\/([a-z0-9_]+)(?:@[\w]+)?\s*$/i;

/**
 * The command a group is, if it is one — so `/start` is answered rather than saved as a
 * quote card reading "/start".
 *
 * Only a lone, text-only message counts: a photo caption that happens to begin with a
 * slash is a caption, and dropping it would lose the memory's words.
 *
 * @returns {string|null} lowercase command name
 */
export function readCommand(group) {
  if (!Array.isArray(group) || group.length !== 1) return null;
  const message = group[0];
  if (message.photo || message.document) return null;
  const match = String(message.text || '').trim().match(COMMAND);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Telegram sends one message per photo in an album, tied together by media_group_id.
 * Group them so an album becomes one post rather than five.
 *
 * @param {object[]} messages
 * @returns {object[][]} groups, each in message order
 */
export function groupMessages(messages) {
  const groups = [];
  const byMediaGroup = new Map();

  for (const message of [...messages].sort((a, b) => a.message_id - b.message_id)) {
    const key = message.media_group_id;
    if (!key) {
      groups.push([message]);
      continue;
    }
    if (!byMediaGroup.has(key)) {
      const group = [];
      byMediaGroup.set(key, group);
      groups.push(group);
    }
    byMediaGroup.get(key).push(message);
  }
  return groups;
}

/**
 * Telegram offers each photo at several sizes. The largest is the closest thing to what
 * was actually taken, and Phase 3's pipeline is where downsizing belongs — not here,
 * where it would be irreversible.
 */
function largestPhoto(sizes) {
  return [...sizes].sort((a, b) => (a.width * a.height) - (b.width * b.height)).pop();
}

/** Local calendar day for a Telegram timestamp (seconds since epoch). */
function localDay(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Pull a milestone out of the text, and return the text with the tag removed.
 * @returns {{caption: string|null, milestone: {isMilestone: true, title: string}|null}}
 */
export function readMilestone(text) {
  const source = String(text || '');
  const match = source.match(MILESTONE_TAG);
  if (!match) return { caption: source.trim() || null, milestone: null };

  const rest = source.replace(MILESTONE_TAG, '').trim();
  // The title is whatever followed the tag; failing that, the rest of the message, so
  // "#milestone First steps" and "First steps #milestone" both do the obvious thing.
  const title = (match[1] || '').trim() || rest || 'Milestone';
  return {
    caption: rest || null,
    milestone: { isMilestone: true, title },
  };
}

/**
 * Build a draft from one group of messages.
 *
 * @param {object[]} group messages belonging to a single post, in order
 * @returns {{memoryDate, caption, milestone,
 *            photos: Array<{fileId, videoFileId?, width?, height?, duration?,
 *                           needsMeasuring?, size?, name?}>,
 *            unsupported: string[]}|null} null when there is nothing to post
 */
export function draftFromMessages(group) {
  if (!Array.isArray(group) || !group.length) return null;

  const photos = [];
  const unsupported = [];
  let text = '';

  for (const message of group) {
    // The caption rides on one message of an album — usually the first, but not always.
    const caption = message.caption || message.text || '';
    if (caption.trim() && !text) text = caption;

    // A live/motion photo. Telegram sends the clip's file_id here and, FOR BACKWARD
    // COMPATIBILITY, also fills in `photo` with the flat still — so a parser that checks
    // `photo` first finds it, returns happily, and throws the motion away without ever
    // noticing. That is exactly what happened: the clip was always being delivered.
    // This has to be checked BEFORE `photo`, and the order is the whole fix.
    const live = message.live_photo;
    if (live) {
      // `live_photo.photo` holds the still's sizes; `width`/`height` on the live photo
      // itself describe the VIDEO. The still is what gets stored and laid out, so its
      // dimensions win, falling back to the compatibility copy and then to the video's.
      const sizes = Array.isArray(live.photo) && live.photo.length ? live.photo : message.photo;
      const best = Array.isArray(sizes) && sizes.length ? largestPhoto(sizes) : null;
      photos.push({
        fileId: best?.file_id || null,
        videoFileId: live.file_id,
        width: best?.width || live.width,
        height: best?.height || live.height,
        // Stated in whole seconds, so a sub-second clip rounds to 0. The runtime reads
        // the real length out of the file rather than trusting this when it is missing.
        duration: live.duration || 0,
        size: live.file_size || 0,
        // A live photo IS motion, whatever its rounded duration says. Nothing about it
        // should be left to the length heuristic that separates clips from videos.
        isLive: true,
        name: 'live photo',
      });
      continue;
    }

    // A video or an animation (a GIF, which Telegram stores as a silent mp4). Telegram
    // states the dimensions and the length on the message, and supplies a thumbnail —
    // which becomes the poster, so nothing has to decode a frame in node.
    const clip = message.video || message.animation;
    if (clip) {
      photos.push({
        fileId: clip.thumbnail?.file_id || clip.thumb?.file_id || null,
        videoFileId: clip.file_id,
        width: clip.width,
        height: clip.height,
        duration: clip.duration || 0,
        size: clip.file_size || 0,
        // An animation has no sound and loops by nature; whether it reads as a motion
        // photo is still decided by its length, exactly as in the app.
        name: clip.file_name || 'clip',
      });
      continue;
    }

    if (Array.isArray(message.photo) && message.photo.length) {
      const best = largestPhoto(message.photo);
      photos.push({
        fileId: best.file_id,
        width: best.width,
        height: best.height,
        size: best.file_size || 0,
      });
      continue;
    }

    const doc = message.document;
    if (doc?.mime_type?.startsWith('video/')) {
      // A clip sent as a file keeps its original quality, but carries no dimensions and
      // no thumbnail of its own, so there is nothing to build a poster from.
      unsupported.push(`${doc.file_name || 'video file'} (send it as a video, not a file)`);
    } else if (doc?.mime_type?.startsWith('image/')) {
      // Sent as a file, so the ORIGINAL bytes arrive — which is the only way a Google
      // motion photo survives Telegram at all. Dimensions are read from the header once
      // it is downloaded; nothing here needs to guess them.
      photos.push({
        fileId: doc.file_id,
        needsMeasuring: true,
        size: doc.file_size || 0,
        name: doc.file_name || 'photo',
      });
    }
  }

  const { caption, milestone } = readMilestone(text);
  if (!photos.length && !caption) return null; // nothing the engine could render

  return {
    memoryDate: localDay(group[0].date),
    caption,
    milestone,
    photos,
    unsupported,
  };
}

/**
 * Name what was actually saved: "2 photos and a video", not "3 photos".
 *
 * The reply is the only confirmation a parent gets that a clip arrived as a clip rather
 * than as a still — which is exactly the failure Telegram causes with motion photos, so
 * saying "photo" when a video landed would hide the one thing worth noticing.
 *
 * @param {string[]} kinds one per saved item: 'photo' | 'video' | 'motion photo'
 * @returns {string} e.g. "a motion photo", "2 photos and a video"
 */
export function summarise(kinds) {
  const counts = new Map();
  for (const kind of kinds || []) counts.set(kind, (counts.get(kind) || 0) + 1);
  if (!counts.size) return '';

  // Ordered so the ordinary case reads first and the notable kinds land at the end.
  const order = ['photo', 'video', 'motion photo'];
  const parts = [...counts.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([kind, n]) => (n === 1 ? `${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}` : `${n} ${kind}s`));

  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
