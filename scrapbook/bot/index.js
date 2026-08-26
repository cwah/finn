// Telegram bot: a second way into the same scrapbook.
//
//   node bot/index.js
//
// Reads its settings from the environment (see README):
//   TELEGRAM_BOT_TOKEN   from @BotFather
//   PB_BOT_USERNAME      the bot's own PocketBase account
//   PB_BOT_PASSWORD
//   PB_URL               optional, defaults to the local PocketBase
//
// Send it a photo, an album, or a message. Add #milestone to mark one. Everything lands
// as an ordinary post, attributed to whichever parent sent it — the layout engine treats
// it exactly like one made in the app, because it is one.

import { setDefaultResultOrder } from 'node:dns';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient as telegram } from './telegram.js';
import { createClient as pocketbase } from './pocketbase.js';
import { draftFromMessages, readCommand, summarise } from './message.js';
import { imageSize } from './image-size.js';
import {
  findEmbeddedVideo, looksLikeMotion, mp4Duration, mp4CreatedAt,
} from '../js/motion.js';
import { parseDate } from './parse-date.js';
import { exifDate, filenameDate, latestDate } from '../js/media-date.js';
import { MAX_CLIP_SECONDS } from '../js/layout-engine.js';

// Prefer IPv4 when resolving Telegram.
//
// Long polling failed intermittently with a bare "fetch failed", 0.3s in — a connect
// error, not a timeout. api.telegram.org resolves to both families, and on a machine
// running a VPN the IPv6 default route can lead somewhere that quietly discards the
// packets: measured here, IPv4 succeeded 10/10 and IPv6 failed 10/10, with the v6 default
// route pointing into a Tailscale interface.
//
// Node races both families (Happy Eyeballs) so most requests still got through, which is
// why this looked like flakiness rather than a broken route. A failed poll costs no
// messages — the offset only advances on success — but it does delay them, and a bot that
// spends its time retrying looks exactly like a bot that is not working.
//
// Harmless where IPv6 works: it only orders the candidates, and IPv4 reaches Telegram
// everywhere.
setDefaultResultOrder('ipv4first');

// Node reads .env itself since 20.6, so the token never has to be typed on a command line
// where it would land in shell history. Absent is fine — the environment may be set
// directly instead. Anything already exported wins, which is what --env-file does too.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch { /* no .env; fall back to the ambient environment */ }

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const OFFSET_FILE = new URL('./.offset', import.meta.url);

/** Telegram redelivers anything unacknowledged, so the offset must outlive a restart. */
async function loadOffset() {
  try {
    return Number(await readFile(OFFSET_FILE, 'utf8')) || 0;
  } catch {
    return 0;
  }
}
const saveOffset = (n) => writeFile(OFFSET_FILE, String(n));

/**
 * An album arrives as several updates that may straddle two polls. Hold a group until it
 * has been quiet for a moment, then post it as one memory.
 */
const QUIET_MS = 2500;

function createAlbumBuffer(onReady) {
  const pending = new Map(); // media_group_id -> { messages, timer }

  return function add(message) {
    const key = message.media_group_id;
    if (!key) return onReady([message]);

    const entry = pending.get(key) || { messages: [] };
    entry.messages.push(message);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      pending.delete(key);
      onReady(entry.messages);
    }, QUIET_MS);
    pending.set(key, entry);
    return undefined;
  };
}

const HELP = [
  'Send me anything and it goes in the scrapbook:',
  '',
  '· a photo, or an album of them',
  '· a few words on their own — they become a quote card',
  '· #milestone First steps — marks a milestone',
  '· #date 8/14 — dates the memory (month first; I assume this year)',
  '· a video or a GIF — it plays on the card',
  '',
  'A memory is dated from the media itself where it can be — a photo taken on Friday and',
  'sent on Sunday belongs on Friday. Send it as a FILE to keep that timestamp; the',
  'compressed path strips it and the send date has to stand. #date overrides either.',
  '',
  'A clip plays for up to a minute; edit the memory in the app to choose which minute.',
  '',
  'MOTION PHOTOS: send them as a FILE, not as a photo. Telegram strips the motion out of',
  'anything sent the normal way, and only the original file still has it.',
].join('\n');

/** Telegram refuses to hand a bot any file bigger than this, whoever sent it. */
const TELEGRAM_MAX_DOWNLOAD = 20 * 1024 * 1024;

const tooBig = (bytes) =>
  `${(bytes / 1024 / 1024).toFixed(0)} MB — Telegram only lets a bot fetch 20 MB`;

/**
 * Save one item of a draft: download it, work out what it actually is, and store it.
 *
 * Three shapes arrive here and all leave as the same photo record, because a video's
 * poster IS its photo:
 *
 *   a compressed photo   Telegram states the dimensions; nothing to work out.
 *   a video/animation    the dimensions and length are on the message, and Telegram's
 *                        own thumbnail becomes the poster — node cannot decode a frame.
 *   an image sent as a FILE
 *                        the original bytes, so dimensions come from the header and a
 *                        Google motion photo can be split into its still and its clip.
 *                        This is the only route by which motion survives Telegram.
 *
 * Nothing is written here. The post is created only once at least one item has been
 * fetched successfully — the bot cannot delete a post it made (they belong to the parent,
 * and `posts.deleteRule` is author-scoped, which is a rule worth keeping), so the only way
 * not to leave an empty one behind is not to create it in the first place.
 *
 * @returns {Promise<{kind, note?, blob, filename, width, height, video}>}
 */
async function fetchItem(tg, photo, sort) {
  if (photo.size > TELEGRAM_MAX_DOWNLOAD) throw new Error(tooBig(photo.size));

  // What arrived, before anything is fetched. A failure downstream is otherwise a bare
  // "fetch failed" with no way to tell a 6 MB motion photo from a compressed thumbnail.
  const megabytes = photo.size ? `${(photo.size / 1024 / 1024).toFixed(1)} MB` : 'size unstated';
  const shape = photo.isLive ? 'live photo'
    : photo.videoFileId ? 'video'
      : (photo.needsMeasuring ? 'file' : 'photo');
  console.log(`  item ${sort + 1}: ${shape}, ${megabytes}${photo.name ? ` — ${photo.name}` : ''}`);

  let note;
  let takenOn = null;
  let { width, height } = photo;
  let video = null;

  // A clip Telegram already knows the shape of.
  if (photo.videoFileId) {
    if (!photo.fileId) {
      throw new Error('no thumbnail to use as a poster — try sending it as a video');
    }
    const clip = await tg.downloadFile(photo.videoFileId);
    const clipBytes = new Uint8Array(await clip.blob.arrayBuffer());
    // A clip states when it was recorded in the same header that states its length.
    takenOn = mp4CreatedAt(clipBytes) || filenameDate(photo.name);

    // Telegram states a duration in WHOLE seconds, so a live photo of 1.4s can arrive as
    // 1 — or as 0, which would store a clip that trimRange() reports as unplayable and
    // the card would silently render as a still. Read the real length from the file when
    // the stated one is missing; it is in the header, not the frames.
    let duration = Number(photo.duration) || 0;
    if (!duration) duration = mp4Duration(clipBytes);

    if (duration > MAX_CLIP_SECONDS) {
      note = `“${photo.name}” is ${Math.round(duration)}s; the first `
        + `${MAX_CLIP_SECONDS}s will play. Edit the memory to choose a different stretch.`;
    }
    if (!duration) {
      // Nothing playable, so the still is the honest thing to keep.
      note = `“${photo.name}” has motion, but its length could not be read — saved as a still.`;
    }
    video = duration ? {
      blob: clip.blob,
      filename: clip.filename,
      duration,
      trimEnd: Math.min(duration, MAX_CLIP_SECONDS),
      // A live photo is motion by definition; anything else is judged on its length.
      motion: photo.isLive || looksLikeMotion(duration),
    } : null;
  }

  const poster = await tg.downloadFile(photo.fileId);
  let posterBlob = poster.blob;

  // Original bytes: measurable, and possibly a motion photo with an mp4 inside it.
  if (photo.needsMeasuring) {
    const bytes = new Uint8Array(await posterBlob.arrayBuffer());
    // Original bytes, so the photographer's own timestamp is still in them. This is the
    // best answer there is, and only the file path preserves it.
    takenOn = takenOn || exifDate(bytes) || filenameDate(photo.name);
    const found = findEmbeddedVideo(bytes);
    if (found && !video) {
      const clip = bytes.subarray(found.offset);
      posterBlob = new Blob([bytes.subarray(0, found.offset)], { type: 'image/jpeg' });
      // The length has to be READ, not left at 0. A stored duration of 0 makes
      // trimRange() report nothing playable and hasVideo() false, so the card falls back
      // to a plain still — a motion photo that split correctly and rendered as a photo
      // anyway. node cannot decode video, but the mvhd box states the length outright.
      const duration = mp4Duration(clip);
      video = {
        blob: new Blob([clip], { type: 'video/mp4' }),
        filename: 'motion.mp4',
        duration,
        trimEnd: Math.min(duration, MAX_CLIP_SECONDS),
        // Length decides looping, exactly as in the app — an unreadable one is not
        // assumed to be a moment.
        motion: looksLikeMotion(duration),
      };
      note = duration
        ? `“${photo.name}” came through as a motion photo.`
        : `“${photo.name}” has motion, but its length could not be read — saved as a still.`;
      if (!duration) video = null; // better an honest photo than a clip that cannot play
    }
    const size = imageSize(new Uint8Array(await posterBlob.arrayBuffer()));
    if (!size) throw new Error(`could not read the size of “${photo.name}”`);
    ({ width, height } = size);
  }

  // A compressed photo has neither EXIF nor a real filename — Telegram strips one and
  // replaces the other — so there is nothing to read and the send date has to stand.
  takenOn = takenOn || filenameDate(photo.name);

  // What it turned out to BE, not what was sent — a motion photo sent as a file arrives
  // looking like a photo and only becomes motion once its clip is found.
  const kind = video ? (video.motion ? 'motion photo' : 'video') : 'photo';
  // Telegram re-encodes anything sent as a "photo" and caps it at 2560px, which destroys
  // a motion photo's appended clip before the bot ever sees it. Worth surfacing: the
  // picker still calls it a motion photo, so the loss is invisible from the phone.
  const compressed = !photo.videoFileId && !photo.needsMeasuring && !photo.isLive;
  return {
    kind, note, compressed, takenOn,
    blob: posterBlob, filename: poster.filename, width, height, video,
  };
}

/** One group of messages -> one saved post. */
async function handleGroup(messages, { tg, pb, botAccountId }) {
  const chatId = messages[0].chat.id;
  const from = messages[0].from;
  const senderId = from?.id;

  // Anyone can find a bot by name, so the sender's Telegram id has to map to a parent's
  // account before anything is written. This is the ONLY thing standing in front of the
  // data — there is no other gate.
  //
  // A sender with no id at all (a channel post, an anonymous group admin) maps to nobody
  // and is refused by the same check.
  const author = senderId ? await pb.findUserByTelegramId(senderId) : null;

  // The bot's own account must never be an author, even if someone puts a Telegram id on
  // it by mistake. Posts would be credited to "Telegram bot" instead of to a parent, and
  // attribution surviving the bot is the whole point of mapping senders to people.
  const allowed = author && author.id !== botAccountId;

  if (!allowed) {
    // Logged, so an attempt to write to the scrapbook is visible rather than silent.
    const who = [from?.username && `@${from.username}`, from?.first_name]
      .filter(Boolean).join(' ') || 'unknown sender';
    console.warn(`refused ${who} (telegram id ${senderId ?? 'none'})`
      + `${author ? ' — that is the bot’s own account' : ''}`);

    await tg.sendMessage(chatId,
      `This scrapbook is private.\n\nIf it is yours, put this Telegram id on your account `
      + `in PocketBase (users -> telegramId):\n\n${senderId}`);
    return;
  }

  const command = readCommand(messages);
  if (command === 'id') {
    await tg.sendMessage(chatId, `Your Telegram id is ${senderId}.`);
    return;
  }
  if (command) {
    await tg.sendMessage(chatId, HELP);
    return;
  }

  // What Telegram ACTUALLY delivered, by field name.
  //
  // EXHAUSTIVE, deliberately: this was a whitelist of the fields I expected, which is
  // useless for the question it was meant to answer. A whitelist cannot show that
  // Telegram sent something unanticipated — it filters out precisely the evidence worth
  // having, and did. Every key is listed now except the plainly uninteresting ones.
  //
  // Names only: captions are the parents' words and do not belong in a log.
  const BORING = new Set(['message_id', 'date', 'chat', 'from', 'caption',
    'caption_entities', 'entities', 'text', 'link_preview_options']);
  for (const m of messages) {
    const fields = Object.keys(m).filter((k) => !BORING.has(k));
    const sizes = Array.isArray(m.photo)
      ? ` photo=[${m.photo.map((p) => `${p.width}x${p.height}`).join(' ')}]` : '';
    console.log(`  message ${m.message_id}: ${fields.join(', ') || '(nothing)'}${sizes}`);
  }

  const draft = draftFromMessages(messages);
  if (!draft) {
    await tg.sendMessage(chatId, HELP);
    return;
  }

  // An explicit #date is read before a single byte is fetched. A date that cannot be
  // understood, or that lands in the future, stops the post here rather than after
  // several megabytes have crossed the wire.
  let dated = null;
  if (draft.dateRequest) {
    dated = parseDate(draft.dateRequest);
    if (!dated) {
      await tg.sendMessage(chatId,
        `I could not read “${draft.dateRequest}” as a date, so nothing was saved.\n\n`
        + 'Try 8/14, 8-14-26 or August 14 2026 — month comes first — '
        + 'or yesterday, two weeks ago, last friday.');
      return;
    }
    if (dated.future) {
      const year = dated.hadYear ? '' : ' I assumed this year, since you did not say.';
      await tg.sendMessage(chatId,
        `${dated.date} is in the future, so I have not saved anything yet.${year}\n\n`
        + 'Send it again with the date you meant — including the year if it was a while '
        + 'ago, like #date 12/25/2025.');
      return;
    }
  }

  // Fetch everything from Telegram BEFORE writing anything. An album is a handful of
  // phone photos, so holding them briefly is cheap next to leaving a post with nothing in
  // it — which is what a parent saw as a caption sitting alone in the timeline where a
  // photo should have been.
  const fetched = [];
  const failed = [];
  const notes = [];
  for (const [i, photo] of draft.photos.entries()) {
    try {
      const item = await fetchItem(tg, photo, i);
      if (item.note) notes.push(item.note);
      fetched.push(item);
    } catch (err) {
      // One bad item should not cost the parent the rest of the album.
      console.error(`  item ${i + 1} of ${draft.photos.length} failed:`, err.message);
      failed.push(err.message);
    }
  }

  // Nothing survived, so there is no memory to write. Saying so and stopping is kinder
  // than a post that looks deliberate but is missing the thing it was about.
  if (draft.photos.length && !fetched.length) {
    await tg.sendMessage(chatId,
      `That did not save — ${[...new Set(failed)].join('; ')}.`
      + `\n\nNothing was added, so send it again. If it keeps failing it may be bigger than `
      + `Telegram will hand me (20 MB), in which case add it in the app instead.`);
    console.warn(`nothing saved — all ${draft.photos.length} item(s) failed`);
    return;
  }

  // When the memory happened, in order of who knows best:
  //
  //   1. an explicit #date — the parent said so outright
  //   2. the media's own timestamp — a photo taken on Friday and sent on Sunday belongs
  //      on Friday, and memoryDate is authored, never inferred from upload time
  //   3. the day it was sent, which is all a compressed photo leaves to go on
  //
  // The most RECENT item wins among several: a set of photos is one memory, and it
  // belongs on the day it finished happening.
  let memoryDate = draft.memoryDate;
  let dateNote;
  if (dated) {
    memoryDate = dated.date;
  } else {
    const fromMedia = latestDate(fetched.map((f) => f.takenOn));
    // A camera with a wrong clock can claim tomorrow; the send date is the safer answer.
    if (fromMedia && fromMedia <= draft.memoryDate) {
      memoryDate = fromMedia;
      if (fromMedia !== draft.memoryDate) {
        dateNote = `Dated ${fromMedia}, from the media itself. `
          + 'Send #date to say otherwise, or change it in the app.';
      }
    }
  }

  const post = await pb.createPost({ ...draft, memoryDate, authorId: author.id });

  const savedKinds = [];
  for (const [sort, item] of fetched.entries()) {
    try {
      await pb.createPhoto({ postId: post.id, sort, ...item });
      savedKinds.push(item.kind);
    } catch (err) {
      console.error(`  storing item ${sort + 1} failed:`, err.message);
      failed.push(err.message);
    }
  }

  const parts = [draft.milestone ? `Milestone saved: ${draft.milestone.title}` : 'Saved'];
  if (savedKinds.length) parts.push(summarise(savedKinds));

  // If everything arrived compressed, say so once. A parent whose motion photo quietly
  // became a still has no other way of telling why — Telegram's own picker still shows it
  // as a motion photo, and the reply would otherwise just say "a photo".
  if (fetched.length && fetched.every((f) => f.compressed)) {
    notes.push('Sent compressed, so any motion or original quality was lost on the way. '
      + 'Attach as a FILE instead to keep it.');
  }
  if (failed.length) parts.push(`\n\nFailed: ${[...new Set(failed)].join('; ')}`);
  if (dateNote) notes.push(dateNote);
  if (notes.length) parts.push(`\n\n${notes.join('\n')}`);
  if (draft.unsupported.length) {
    parts.push('\n\nSent as a file, so I skipped it: '
      + `${draft.unsupported.join(', ')}. Send it as a photo and I can size it properly.`);
  }
  await tg.sendMessage(chatId, `${parts.join(' · ')} — for ${author.name || author.email}.`);
  console.log(`saved ${post.id} for ${author.name} (${summarise(savedKinds) || 'no media'})`);
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  // PB_BOT_EMAIL is still read, so an env file written before logins moved to usernames
  // keeps starting the bot. It has to hold the USERNAME now either way: PocketBase only
  // accepts what `identityFields` names, and that is no longer an address.
  const identity = process.env.PB_BOT_USERNAME || process.env.PB_BOT_EMAIL;
  const password = process.env.PB_BOT_PASSWORD;

  const missing = [
    !token && 'TELEGRAM_BOT_TOKEN',
    !identity && 'PB_BOT_USERNAME',
    !password && 'PB_BOT_PASSWORD',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')}. See the Telegram section of README.md.`);
    process.exit(1);
  }

  const tg = telegram(token);
  const pb = pocketbase(PB_URL);

  const me = await tg.getMe();
  let botAccount;
  try {
    botAccount = await pb.signIn(identity, password);
  } catch (err) {
    // The likeliest cause by far, and worth naming rather than leaving as a bare 400.
    console.error(`Could not sign in as “${identity}”: ${err.message}\n\n`
      + 'Logins accept a username or an email address, whichever the users collection '
      + 'lists in identityFields. Check PB_BOT_USERNAME against the account in the '
      + 'admin UI.');
    process.exit(1);
  }
  console.log(`@${me.username} -> ${PB_URL} as ${botAccount.username || botAccount.email}`);

  let offset = await loadOffset();
  const buffer = createAlbumBuffer((messages) => {
    handleGroup(messages, { tg, pb, botAccountId: botAccount.id }).catch(async (err) => {
      console.error('failed:', err);
      try {
        await tg.sendMessage(messages[0].chat.id, `Could not save that: ${err.message}`);
      } catch { /* the reply failing must not take the bot down */ }
    });
  });

  console.log('listening — Ctrl-C to stop');
  for (;;) {
    try {
      const updates = await tg.getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) buffer(update.message);
      }
      if (updates.length) await saveOffset(offset);
    } catch (err) {
      // Network blips and Telegram hiccups are expected on a long poll; back off and
      // retry rather than exiting, so the bot survives a laptop sleeping.
      console.error('poll failed, retrying:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
