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

/** Sets the day a memory belongs to. Everything after it on the line is the date. */
const DATE_TAG = /#date\b[ \t]*:?[ \t]*([^\n]*)/i;

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
 * Pull a #date request out of the text, and return the text with the tag removed.
 *
 * Only the raw words are taken here. Turning them into a day needs to know what today is,
 * and a module that reads the clock cannot be tested against awkward dates — so the
 * parsing lives in parse-date.js and is handed a date by the caller.
 *
 * @returns {{caption: string, requested: string|null}}
 */
export function readDateTag(text) {
  const source = String(text || '');
  const match = source.match(DATE_TAG);
  if (!match) return { caption: source, requested: null };
  return {
    caption: source.replace(DATE_TAG, ' ').replace(/\s+/g, ' ').trim(),
    requested: (match[1] || '').trim() || null,
  };
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

  // #date comes off first, so its words cannot end up inside a milestone title.
  const { caption: withoutDate, requested } = readDateTag(text);
  const { caption, milestone } = readMilestone(withoutDate);
  if (!photos.length && !caption) return null; // nothing the engine could render

  return {
    // When the message was sent. Only a fallback: the media usually knows better, and an
    // explicit #date beats both. memoryDate is authored, never inferred from upload time.
    memoryDate: localDay(group[0].date),
    dateRequest: requested,
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

/**
 * When the memory happened, and what to tell the parent about how that was decided.
 *
 * In order of who knows best:
 *
 *   1. an explicit #date — the parent said so outright, and nothing outranks that
 *   2. the media's own timestamps — a photo taken on Friday and sent on Sunday belongs
 *      on Friday, because memoryDate is authored, never inferred from upload time
 *   3. the day it was sent, which is all a compressed photo leaves to go on
 *
 * Among several items the most RECENT wins: a set of photos is one memory, and it belongs
 * on the day it finished happening.
 *
 * The app's compose sheet asks for UNANIMITY instead and falls back to today. That looks
 * like an inconsistency and is a deliberate one: there, the fallback sits in an editable
 * field in front of the parent before anything is saved, so an obvious placeholder costs
 * nothing. Here the post is already written by the time they read the reply, and fixing it
 * means opening the app — so the closer guess is worth keeping.
 *
 * What it must not be is SILENT about having guessed. When the media come from more than
 * one day the note says which days were seen and which was picked, so a parent can tell a date
 * that was READ from a date that was CHOSEN. There is no note when there was no judgement
 * to report — an explicit #date, or media agreeing with the send date.
 *
 * @param {object} args
 * @param {string[]} args.days distinct media days, ascending (see distinctDates)
 * @param {string|null} args.dated an accepted #date, or null
 * @param {string} args.sentOn the day it arrived, as a local calendar day
 * @returns {{memoryDate: string, note: string|undefined}}
 */
export function dateMemory({ days = [], dated = null, sentOn }) {
  if (dated) return { memoryDate: dated, note: undefined };

  const latest = days.length ? days[days.length - 1] : null;

  // A camera with a wrong clock can claim tomorrow. Rejecting the whole inference rather
  // than falling back to the newest day that is not in the future is deliberate: a clock
  // that is wrong by a day is wrong on every photo it took, so the "valid" ones are no
  // more trustworthy than the one that gave the error away.
  if (!latest || latest > sentOn) return { memoryDate: sentOn, note: undefined };

  if (days.length > 1) {
    return {
      memoryDate: latest,
      // "from 3 different days", not "span 3 days" — the latter reads as a three-day
      // stretch, which is wrong the moment the oldest item is from years earlier.
      note: `These are from ${days.length} different days (${days[0]} to ${latest}), `
        + `so I dated the memory ${latest}, the last of them. `
        + 'Send #date to say otherwise, or change it in the app.',
    };
  }

  return {
    memoryDate: latest,
    note: latest === sentOn ? undefined
      : `Dated ${latest}, from the media itself. `
        + 'Send #date to say otherwise, or change it in the app.',
  };
}
