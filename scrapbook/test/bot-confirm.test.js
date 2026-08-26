// The "was that meant?" flow, end to end through handleGroup.
//
//   npm test
//
// These exercise the WIRING, not the rules — countCompressed and readConfirmation are
// tested next door in bot-message.test.js. What is checked here is the part that has
// actually broken on this bot before: state held between messages, one branch reached
// when another was intended, and a reply that goes out while nothing is saved.
//
// Telegram and PocketBase are stubs. Nothing here touches a network, and no post is
// created anywhere — the pb stub records what WOULD have been written, which is the only
// way to assert that asking a question saves nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleGroup, awaitingConfirmation } from '../bot/index.js';

const CHAT = 4242;
const SENDER = 99;
const AT = Math.floor(new Date(2026, 7, 14, 12, 0, 0).getTime() / 1000);

const base = (id) => ({
  message_id: id,
  date: AT,
  chat: { id: CHAT },
  from: { id: SENDER, first_name: 'Catherine' },
});

const photoMsg = (id, extra = {}) => ({
  ...base(id),
  photo: [{ file_id: `s${id}`, width: 320, height: 240, file_size: 1000 },
    { file_id: `b${id}`, width: 1600, height: 1200, file_size: 90000 }],
  ...extra,
});

const fileMsg = (id, extra = {}) => ({
  ...base(id),
  document: {
    file_id: `d${id}`, mime_type: 'image/jpeg', file_name: `PXL_20260807_1${id}.jpg`,
    file_size: 90000,
  },
  ...extra,
});

const textMsg = (id, text) => ({ ...base(id), text });

/** A one-pixel jpeg, so imageSize has real bytes to read rather than a stub's promise. */
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00,
  0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

function harness() {
  const sent = [];
  const created = [];
  const tg = {
    async sendMessage(chatId, text) { sent.push({ chatId, text }); },
    async downloadFile() {
      return { blob: new Blob([JPEG], { type: 'image/jpeg' }), filename: 'file_1.jpg' };
    },
  };
  const pb = {
    async findUserByTelegramId() {
      return { id: 'parent1', name: 'Catherine', email: 'c@example.com', canPost: true };
    },
    async createPost(post) { created.push(post); return { id: `post${created.length}` }; },
    async createPhoto() { return { id: 'photo1' }; },
  };
  return {
    tg,
    pb,
    sent,
    created,
    last: () => sent[sent.length - 1]?.text || '',
    run: (messages) => handleGroup(messages, { tg, pb, botAccountId: 'botacct' }),
  };
}

// Held state is per-chat and lives across calls, so it has to be cleared between tests or
// each one inherits the last one's question.
const fresh = () => { awaitingConfirmation.clear(); return harness(); };

test('a compressed photo is queried, and NOTHING is saved yet', async () => {
  const h = fresh();
  await h.run([photoMsg(1)]);
  assert.equal(h.created.length, 0, 'no post may be created while a question is open');
  assert.match(h.last(), /compressed/);
  assert.match(h.last(), /Reply YES/);
  assert.equal(awaitingConfirmation.has(CHAT), true);
});

test('YES saves the post it was asked about', async () => {
  const h = fresh();
  await h.run([photoMsg(1)]);
  await h.run([textMsg(2, 'yes')]);
  assert.equal(h.created.length, 1);
  assert.equal(awaitingConfirmation.has(CHAT), false, 'the question must not outlive its answer');
  assert.match(h.last(), /Saved/);
});

test('YES saves the ORIGINAL media, not the word yes', async () => {
  // The replay is the whole trick: "yes" is a text message and would otherwise become a
  // quote card reading "yes" while the photos were quietly dropped.
  const h = fresh();
  await h.run([photoMsg(1, { caption: 'Bath time' })]);
  await h.run([textMsg(2, 'yes')]);
  assert.equal(h.created[0].caption, 'Bath time');
  assert.notEqual(h.created[0].caption, 'yes');
});

test('NO saves nothing and clears the question', async () => {
  const h = fresh();
  await h.run([photoMsg(1)]);
  await h.run([textMsg(2, 'no')]);
  assert.equal(h.created.length, 0);
  assert.equal(awaitingConfirmation.has(CHAT), false);
  assert.match(h.last(), /nothing saved/i);
  assert.match(h.last(), /FILE/);
});

test('a file is saved outright, with no question', async () => {
  const h = fresh();
  await h.run([fileMsg(1)]);
  assert.equal(h.created.length, 1);
  assert.equal(awaitingConfirmation.has(CHAT), false);
  assert.doesNotMatch(h.last(), /Reply YES/);
});

test('a quote card is never queried', async () => {
  const h = fresh();
  await h.run([textMsg(1, 'He said “dada” today')]);
  assert.equal(h.created.length, 1);
  assert.doesNotMatch(h.last(), /compressed/);
});

test('sending again supersedes the outstanding question', async () => {
  // The second send is what the parent meant; a YES afterwards must attach to it, not to
  // the abandoned one. Two questions outstanding at once is how a "yes" saves the wrong
  // post an hour later.
  const h = fresh();
  await h.run([photoMsg(1, { caption: 'first' })]);
  await h.run([photoMsg(2, { caption: 'second' })]);
  await h.run([textMsg(3, 'yes')]);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].caption, 'second');
});

test('an unrelated message drops the question rather than leaving it armed', async () => {
  const h = fresh();
  await h.run([photoMsg(1)]);
  await h.run([textMsg(2, 'actually hold on')]);     // becomes its own quote card
  assert.equal(awaitingConfirmation.has(CHAT), false);
  await h.run([textMsg(3, 'yes')]);                  // now just a quote card, not an answer
  assert.equal(h.created.length, 2, 'the abandoned photo must not be resurrected');
  assert.equal(h.created[0].caption, 'actually hold on');
  assert.equal(h.created[1].caption, 'yes');
});

test('a stale question is not answered by a yes an hour later', async () => {
  const h = fresh();
  await h.run([photoMsg(1)]);
  // Reach into the held entry and age it past the TTL, rather than waiting an hour.
  awaitingConfirmation.get(CHAT).askedAt -= 61 * 60 * 1000;
  await h.run([textMsg(2, 'yes')]);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].caption, 'yes', 'the stale photo must not be saved');
});

test('a yes with nothing pending is just a memory', async () => {
  const h = fresh();
  await h.run([textMsg(1, 'yes')]);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].caption, 'yes');
});

test('an album is queried once, and confirms as one post', async () => {
  const h = fresh();
  await h.run([
    photoMsg(1, { media_group_id: 'a', caption: 'Park' }),
    photoMsg(2, { media_group_id: 'a' }),
    photoMsg(3, { media_group_id: 'a' }),
  ]);
  assert.equal(h.sent.length, 1);
  assert.match(h.last(), /Those 3 came through compressed/);
  await h.run([textMsg(4, 'yes')]);
  assert.equal(h.created.length, 1, 'three photos are one memory, not three');
  assert.equal(h.created[0].caption, 'Park');
});

test('a bad #date is reported before the compressed question', async () => {
  // Two things wrong at once. The date is the one that stops the post, and asking about
  // compression as well would be a second question about a post that is not being saved.
  const h = fresh();
  await h.run([photoMsg(1, { caption: '#date the day before the thing' })]);
  assert.equal(h.created.length, 0);
  assert.match(h.last(), /could not read/i);
  assert.equal(awaitingConfirmation.has(CHAT), false, 'nothing should be held');
});

test('a confirmed compressed post still explains its date', async () => {
  // The parent said yes, so the post is saved — but the reply must still say why it is
  // dated today, since that is the thing they gave up by sending it compressed.
  const h = fresh();
  await h.run([photoMsg(1)]);
  await h.run([textMsg(2, 'yes')]);
  assert.match(h.last(), /Telegram strips the timestamp/);
});
