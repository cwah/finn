// Turning Telegram messages into a post draft. The bot is a second door into the same
// scrapbook, so what arrives through it has to be the same shape the compose sheet makes.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupMessages, draftFromMessages, readMilestone, readCommand, summarise, readDateTag,
  dateMemory,
} from '../bot/message.js';

/** 2026-08-14 12:00 local, so the date assertions do not depend on the runner's clock. */
const AT = Math.floor(new Date(2026, 7, 14, 12, 0, 0).getTime() / 1000);
const DAY = '2026-08-14';

const photoMsg = (id, extra = {}) => ({
  message_id: id,
  date: AT,
  photo: [
    { file_id: `small-${id}`, width: 320, height: 240 },
    { file_id: `big-${id}`, width: 1600, height: 1200 },
    { file_id: `mid-${id}`, width: 800, height: 600 },
  ],
  ...extra,
});

// ── Albums ────────────────────────────────────────────────────────
test('an album becomes one post, not one per photo', () => {
  const groups = groupMessages([
    photoMsg(1, { media_group_id: 'a' }),
    photoMsg(2, { media_group_id: 'a' }),
    photoMsg(3, { media_group_id: 'a' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(draftFromMessages(groups[0]).photos.length, 3);
});

test('separate messages stay separate posts', () => {
  const groups = groupMessages([photoMsg(1), photoMsg(2)]);
  assert.equal(groups.length, 2);
});

test('two albums arriving interleaved do not merge', () => {
  const groups = groupMessages([
    photoMsg(1, { media_group_id: 'a' }),
    photoMsg(2, { media_group_id: 'b' }),
    photoMsg(3, { media_group_id: 'a' }),
    photoMsg(4, { media_group_id: 'b' }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.length), [2, 2]);
});

test('messages are ordered even if they arrive out of order', () => {
  const groups = groupMessages([photoMsg(3), photoMsg(1), photoMsg(2)]);
  assert.deepEqual(groups.map((g) => g[0].message_id), [1, 2, 3]);
});

// ── Photos ────────────────────────────────────────────────────────
test('the largest offered size is kept, whatever order Telegram lists them in', () => {
  const draft = draftFromMessages([photoMsg(1)]);
  assert.deepEqual(draft.photos, [{
    fileId: 'big-1', width: 1600, height: 1200, size: 0,
  }]);
});

test('the file size comes through when Telegram states it', () => {
  // Used to check the 20 MB download ceiling before fetching, and to say how big an item
  // was when one fails.
  const msg = photoMsg(1);
  msg.photo[1].file_size = 812_345;
  assert.equal(draftFromMessages([msg]).photos[0].size, 812_345);
});

test('dimensions come through, since every layout depends on them', () => {
  const draft = draftFromMessages([photoMsg(1)]);
  assert.equal(draft.photos[0].width, 1600);
  assert.equal(draft.photos[0].height, 1200);
});

test('an image sent as a FILE is accepted, and measured after download', () => {
  // Sending as a file is the ONLY way a motion photo survives Telegram — the normal
  // path strips it. A document carries no dimensions, so it is flagged for measuring
  // from its own header bytes rather than refused.
  const draft = draftFromMessages([{
    message_id: 1,
    date: AT,
    caption: 'original quality',
    document: { file_id: 'doc', mime_type: 'image/jpeg', file_name: 'IMG_1234.jpg', file_size: 900 },
  }]);
  assert.deepEqual(draft.unsupported, []);
  assert.equal(draft.photos.length, 1);
  assert.equal(draft.photos[0].fileId, 'doc');
  assert.equal(draft.photos[0].needsMeasuring, true);
  assert.equal(draft.photos[0].width, undefined, 'nothing may guess a dimension');
});

// ── Live / motion photos ──────────────────────────────────────────
// Telegram sets `photo` as well as `live_photo` for backward compatibility, so a parser
// that checks `photo` first finds it, returns happily, and throws the motion away. These
// pin the ORDER, which is the whole of the fix.

const livePhotoMsg = (extra = {}) => ({
  message_id: 1,
  date: AT,
  live_photo: {
    file_id: 'clip',
    file_unique_id: 'u',
    width: 1080,
    height: 1440,
    duration: 2,
    file_size: 3_100_000,
    photo: [
      { file_id: 'still-small', width: 320, height: 427 },
      { file_id: 'still-big', width: 3072, height: 4080 },
    ],
  },
  // Telegram fills this in too. It must NOT win.
  photo: [{ file_id: 'compat-still', width: 1280, height: 1707 }],
  ...extra,
});

test('a live photo keeps its motion, despite `photo` also being set', () => {
  const item = draftFromMessages([livePhotoMsg()]).photos[0];
  assert.equal(item.videoFileId, 'clip', 'the clip must be picked up');
  assert.equal(item.isLive, true);
});

test('the still comes from live_photo.photo, at its largest size', () => {
  const item = draftFromMessages([livePhotoMsg()]).photos[0];
  assert.equal(item.fileId, 'still-big');
  assert.equal(item.width, 3072, 'the STILL sets the dimensions, not the video');
  assert.equal(item.height, 4080);
});

test('the compatibility photo is the fallback when live_photo has no still', () => {
  const msg = livePhotoMsg();
  delete msg.live_photo.photo;
  const item = draftFromMessages([msg]).photos[0];
  assert.equal(item.fileId, 'compat-still');
  assert.equal(item.width, 1280);
});

test('with no still anywhere, the video’s own shape is used', () => {
  const msg = livePhotoMsg();
  delete msg.live_photo.photo;
  delete msg.photo;
  const item = draftFromMessages([msg]).photos[0];
  assert.equal(item.width, 1080);
  assert.equal(item.height, 1440);
});

test('a duration rounded away to 0 is not treated as a real length', () => {
  // Telegram states whole seconds, so a 1.4s live photo can arrive as 1 — or as 0. The
  // runtime reads the real length from the file rather than storing an unplayable clip.
  const msg = livePhotoMsg();
  msg.live_photo.duration = 0;
  assert.equal(draftFromMessages([msg]).photos[0].duration, 0);
});

test('a live photo carries its size, for the 20 MB ceiling', () => {
  assert.equal(draftFromMessages([livePhotoMsg()]).photos[0].size, 3_100_000);
});

test('an album of live photos stays one post, each keeping its clip', () => {
  const one = livePhotoMsg({ media_group_id: 'a' });
  const two = { ...livePhotoMsg({ media_group_id: 'a' }), message_id: 2 };
  const groups = groupMessages([one, two]);
  assert.equal(groups.length, 1);
  assert.deepEqual(draftFromMessages(groups[0]).photos.map((p) => p.videoFileId),
    ['clip', 'clip']);
});

// ── Video ─────────────────────────────────────────────────────────
test('a video becomes a post, with its poster taken from Telegram’s thumbnail', () => {
  const draft = draftFromMessages([{
    message_id: 1,
    date: AT,
    caption: 'First splash',
    video: {
      file_id: 'vid', width: 1920, height: 1080, duration: 34, file_size: 5_000_000,
      thumbnail: { file_id: 'thumb', width: 320, height: 180 },
    },
  }]);
  assert.equal(draft.photos.length, 1);
  assert.deepEqual(
    { ...draft.photos[0], name: undefined },
    { fileId: 'thumb', videoFileId: 'vid', width: 1920, height: 1080,
      duration: 34, size: 5_000_000, name: undefined },
  );
  assert.equal(draft.caption, 'First splash');
});

test('a GIF is a video too — Telegram stores one as a silent mp4', () => {
  const draft = draftFromMessages([{
    message_id: 1,
    date: AT,
    animation: {
      file_id: 'gif', width: 480, height: 480, duration: 2,
      thumbnail: { file_id: 'gifthumb' },
    },
  }]);
  assert.equal(draft.photos[0].videoFileId, 'gif');
  assert.equal(draft.photos[0].duration, 2);
});

test('the older thumb field is honoured as well as thumbnail', () => {
  const draft = draftFromMessages([{
    message_id: 1, date: AT,
    video: { file_id: 'v', width: 100, height: 100, duration: 3, thumb: { file_id: 't' } },
  }]);
  assert.equal(draft.photos[0].fileId, 't');
});

test('a video with no thumbnail still parses — the runtime reports it', () => {
  // Refusing here would lose the caption and the date with it.
  const draft = draftFromMessages([{
    message_id: 1, date: AT, caption: 'hi',
    video: { file_id: 'v', width: 100, height: 100, duration: 3 },
  }]);
  assert.equal(draft.photos[0].fileId, null);
  assert.equal(draft.caption, 'hi');
});

test('a video sent as a FILE is refused, because nothing can pose for it', () => {
  const draft = draftFromMessages([{
    message_id: 1, date: AT, caption: 'clip',
    document: { file_id: 'd', mime_type: 'video/mp4', file_name: 'IMG_9.MOV' },
  }]);
  assert.equal(draft.photos.length, 0);
  assert.match(draft.unsupported[0], /IMG_9\.MOV/);
  assert.match(draft.unsupported[0], /as a video/);
});

test('a video album stays one post', () => {
  const vid = (id) => ({
    message_id: id, date: AT, media_group_id: 'a',
    video: { file_id: `v${id}`, width: 100, height: 100, duration: 4, thumbnail: { file_id: `t${id}` } },
  });
  const groups = groupMessages([vid(1), vid(2)]);
  assert.equal(groups.length, 1);
  assert.equal(draftFromMessages(groups[0]).photos.length, 2);
});

// ── Captions and milestones ───────────────────────────────────────
test('a caption on any message of an album is used', () => {
  const group = [
    photoMsg(1, { media_group_id: 'a' }),
    photoMsg(2, { media_group_id: 'a', caption: 'Sunday at the park' }),
  ];
  assert.equal(draftFromMessages(group).caption, 'Sunday at the park');
});

test('text with no photo is still a post — the engine makes it a quote card', () => {
  const draft = draftFromMessages([{ message_id: 1, date: AT, text: 'Tiny yawns.' }]);
  assert.equal(draft.caption, 'Tiny yawns.');
  assert.equal(draft.photos.length, 0);
});

test('nothing to post returns nothing', () => {
  assert.equal(draftFromMessages([{ message_id: 1, date: AT, text: '   ' }]), null);
  assert.equal(draftFromMessages([]), null);
  assert.equal(draftFromMessages(null), null);
});

test('#milestone marks a milestone and takes its title from what follows', () => {
  const { caption, milestone } = readMilestone('#milestone First steps');
  assert.deepEqual(milestone, { isMilestone: true, title: 'First steps' });
  assert.equal(caption, null, 'the tag should not be left in the caption');
});

test('the tag works at the end of a sentence too', () => {
  const { caption, milestone } = readMilestone('She did it — three wobbly steps! #milestone');
  assert.equal(milestone.isMilestone, true);
  assert.equal(milestone.title, 'She did it — three wobbly steps!');
  assert.equal(caption, 'She did it — three wobbly steps!');
});

test('a title after the tag wins over the surrounding text', () => {
  const { caption, milestone } = readMilestone('So proud of her. #milestone: First steps');
  assert.equal(milestone.title, 'First steps');
  assert.equal(caption, 'So proud of her.');
});

test('a bare tag still produces a usable milestone', () => {
  assert.equal(readMilestone('#milestone').milestone.title, 'Milestone');
});

test('ordinary text is not a milestone', () => {
  for (const text of ['First steps', 'milestone', 'a #milestones tag']) {
    assert.equal(readMilestone(text).milestone, null, text);
  }
});

test('the tag is case-insensitive', () => {
  assert.equal(readMilestone('#Milestone Day one').milestone.title, 'Day one');
});

// ── Commands ──────────────────────────────────────────────────────
const textMsg = (text) => [{ message_id: 1, date: AT, text }];

test('/start is answered, not saved as a quote card reading "/start"', () => {
  assert.equal(readCommand(textMsg('/start')), 'start');
});

test('a command addressed to the bot by name is still a command', () => {
  assert.equal(readCommand(textMsg('/help@scrapbook_bot')), 'help');
});

test('a photo caption beginning with a slash is a caption, not a command', () => {
  // Losing the words would lose part of the memory.
  const group = [photoMsg(1, { caption: '/ the first bath /' })];
  assert.equal(readCommand(group), null);
  assert.equal(draftFromMessages(group).caption, '/ the first bath /');
});

test('words after a slash-word are a caption, since no command takes arguments', () => {
  assert.equal(readCommand(textMsg('/nap time was rough today')), null);
});

test('ordinary text is not a command', () => {
  for (const text of ['start', 'Tiny yawns.', '']) {
    assert.equal(readCommand(textMsg(text)), null, text);
  }
});

test('an album is never a command', () => {
  assert.equal(readCommand([...textMsg('/start'), ...textMsg('/start')]), null);
});

// ── Date ──────────────────────────────────────────────────────────
test('the memory is dated when it was sent, as a local calendar day', () => {
  assert.equal(draftFromMessages([photoMsg(1)]).memoryDate, DAY);
});

test('the first message of an album sets the date', () => {
  const later = Math.floor(new Date(2026, 7, 15, 3, 0, 0).getTime() / 1000);
  const group = [photoMsg(1, { media_group_id: 'a' }), photoMsg(2, { media_group_id: 'a', date: later })];
  assert.equal(draftFromMessages(group).memoryDate, DAY);
});

// ── What the reply says was saved ─────────────────────────────────
test('the reply names what actually landed, not just "photo"', () => {
  // The confirmation is the only sign a clip arrived AS a clip — which is exactly what
  // Telegram breaks for motion photos, so calling everything a photo hides the failure.
  assert.equal(summarise(['photo']), 'a photo');
  assert.equal(summarise(['video']), 'a video');
  assert.equal(summarise(['motion photo']), 'a motion photo');
});

test('several of a kind are counted and pluralised', () => {
  assert.equal(summarise(['photo', 'photo', 'photo']), '3 photos');
  assert.equal(summarise(['video', 'video']), '2 videos');
  assert.equal(summarise(['motion photo', 'motion photo']), '2 motion photos');
});

test('a mixed post reads as a sentence', () => {
  assert.equal(summarise(['photo', 'photo', 'video']), '2 photos and a video');
  assert.equal(
    summarise(['photo', 'video', 'motion photo']),
    'a photo, a video and a motion photo',
  );
});

test('the ordinary kind leads, whatever order things were saved in', () => {
  assert.equal(summarise(['video', 'photo']), 'a photo and a video');
  assert.equal(summarise(['motion photo', 'photo']), 'a photo and a motion photo');
});

test('nothing saved says nothing at all', () => {
  assert.equal(summarise([]), '');
  assert.equal(summarise(null), '');
  assert.equal(summarise(undefined), '');
});

// ── #date ─────────────────────────────────────────────────────────
// The words only. Turning them into a day needs to know what today is, and a module that
// reads the clock cannot be tested against awkward dates — so parse-date.js does that.

test('#date is lifted out and the words after it kept', () => {
  const { caption, requested } = readDateTag('At the park #date 8/14');
  assert.equal(requested, '8/14');
  assert.equal(caption, 'At the park', 'the tag must not be left in the caption');
});

test('the tag may lead, and a colon is optional', () => {
  assert.equal(readDateTag('#date 8/14').requested, '8/14');
  assert.equal(readDateTag('#date: august 14 2026').requested, 'august 14 2026');
  assert.equal(readDateTag('#DATE 8/14').requested, '8/14');
});

test('text with no tag is left exactly as it was', () => {
  const { caption, requested } = readDateTag('Just a normal caption');
  assert.equal(requested, null);
  assert.equal(caption, 'Just a normal caption');
});

test('a bare tag asks for nothing', () => {
  assert.equal(readDateTag('#date').requested, null);
});

test('#date and #milestone coexist without eating each other', () => {
  // #date comes off first, so its words cannot end up inside the milestone title.
  const draft = draftFromMessages([{
    message_id: 1, date: AT,
    photo: [{ file_id: 'p', width: 800, height: 600 }],
    caption: '#milestone First steps #date 8/14',
  }]);
  assert.equal(draft.dateRequest, '8/14');
  assert.equal(draft.milestone.title, 'First steps');
});

test('the draft still falls back to the day it was sent', () => {
  assert.equal(draftFromMessages([photoMsg(1)]).memoryDate, DAY);
  assert.equal(draftFromMessages([photoMsg(1)]).dateRequest, null);
});

// ── Dating a memory sent through the bot ──────────────────────────
const SENT = '2026-08-26';

test('#date outranks everything, and needs no explaining', () => {
  const { memoryDate, note } = dateMemory({ days: ['2026-08-01'], dated: '2026-07-04', sentOn: SENT });
  assert.equal(memoryDate, '2026-07-04');
  assert.equal(note, undefined); // the parent said so; there is nothing to report back
});

test('a photo taken on Friday and sent on Sunday belongs on Friday', () => {
  const { memoryDate, note } = dateMemory({ days: ['2026-08-21'], dated: null, sentOn: SENT });
  assert.equal(memoryDate, '2026-08-21');
  assert.match(note, /Dated 2026-08-21, from the media itself/);
});

test('media agreeing with the send date is not worth a word', () => {
  // Nothing was decided, so saying "dated today, from the media" is noise.
  const { memoryDate, note } = dateMemory({ days: [SENT], dated: null, sentOn: SENT });
  assert.equal(memoryDate, SENT);
  assert.equal(note, undefined);
});

test('nothing readable falls back to the day it was sent', () => {
  // A compressed photo is stripped of EXIF, which is the common case, not an edge one.
  const { memoryDate, note } = dateMemory({ days: [], dated: null, sentOn: SENT });
  assert.equal(memoryDate, SENT);
  assert.equal(note, undefined);
});

test('several days takes the last, and says which days it saw', () => {
  // The app would fall back to today here. The bot keeps the closer guess because the post
  // is already written by the time the parent reads this — but it must not be silent.
  const { memoryDate, note } = dateMemory({
    days: ['2026-08-21', '2026-08-22', '2026-08-24'], dated: null, sentOn: SENT,
  });
  assert.equal(memoryDate, '2026-08-24');
  assert.match(note, /from 3 different days \(2026-08-21 to 2026-08-24\)/);
  assert.match(note, /dated the memory 2026-08-24, the last of them/);
  assert.match(note, /#date/); // and how to overrule it
});

test('several days is reported even when the last of them is today', () => {
  // The date happens to equal the fallback, but a choice was still made between days —
  // which is the thing being reported, not the value it landed on.
  const { note } = dateMemory({ days: ['2026-08-24', SENT], dated: null, sentOn: SENT });
  assert.match(note, /from 2 different days/);
});

test('a clock claiming tomorrow is not trusted at all', () => {
  // Not "use the newest day that is not in the future": a clock wrong by a day is wrong on
  // every photo it took, so the others are no more trustworthy than the one that gave it
  // away. The send date is the only thing here that is known.
  const { memoryDate, note } = dateMemory({
    days: ['2026-08-21', '2027-01-01'], dated: null, sentOn: SENT,
  });
  assert.equal(memoryDate, SENT);
  assert.equal(note, undefined);
});

test('a #date is honoured even when the media would have disagreed', () => {
  const { memoryDate, note } = dateMemory({
    days: ['2026-08-21', '2026-08-24'], dated: '2026-08-01', sentOn: SENT,
  });
  assert.equal(memoryDate, '2026-08-01');
  assert.equal(note, undefined);
});
