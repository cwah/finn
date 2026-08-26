/// <reference path="../../scrapbook/pb_data/types.d.ts" />

// Write a museum wall label for a drawing.
//
// The studio sends the picture and whatever the parent typed; this asks Claude for the
// note and hands the words back for review. Nothing is saved from here — the endpoint
// returns text, the person reads it, and the ordinary save path stores it if they keep
// it. A language model should not be able to put words on a permanent label without
// somebody having looked at them.
//
// It lives in a PocketBase hook rather than in the browser for the obvious reason: the
// API key is a secret and a static page cannot hold one. It reaches the key through
// ANTHROPIC_API_KEY, set in the Render dashboard and deliberately NOT in render.yaml,
// which is committed.
//
// ── EVERY CONSTANT IS DECLARED INSIDE THE HANDLER ────────────────────────────
// PocketBase runs each hook callback in its own goja runtime, so a handler cannot see
// the file's outer scope. A `const` at the top of this file is simply not defined by
// the time the function runs — gallery-404.pb.js shipped that way and did nothing at
// all, silently. This file wants a model name, a key, a URL and a long prompt, which is
// exactly the shape of file that would have made the same mistake four times over.

routerAdd('POST', '/api/gallery/describe', (e) => {
  const KEY = $os.getenv('ANTHROPIC_API_KEY');
  // Overridable without a deploy. Sonnet is a perfectly good writer of forty words and
  // costs a fraction as much, if this is ever called often enough to notice.
  const MODEL = $os.getenv('ANTHROPIC_MODEL') || 'claude-opus-5';
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';

  // Adding a drawing is a privilege, and so is spending money on one. Same flag the
  // collection rules use, so a viewer account cannot reach this.
  if (!e.auth || e.auth.get('canPost') !== true) {
    throw new ForbiddenError('Only accounts that can add drawings can write labels.');
  }
  if (!KEY) {
    throw new ApiError(503, 'No ANTHROPIC_API_KEY is set on the server.', null);
  }

  const body = e.requestInfo().body || {};
  const image = String(body.image || '');
  const mediaType = String(body.mediaType || 'image/jpeg');
  if (!image) throw new BadRequestError('No image was sent.');

  // The wall label itself.
  //
  // Deadpan, not jokey. The comedy is the seriousness of a museum applied to the life
  // of an infant, so the moment it winks it stops working.
  //
  // It is told NOT to describe the picture. The visitor is standing in front of it; a
  // label that recites what they can already see is the one thing a real wall label
  // never does. The image is still sent, because the anecdote has to be about THIS
  // work — but it is source material, not subject matter.
  //
  // The one rule kept from the documentary version: no invented quotations from Finn.
  // Not for accuracy now, but because it is funnier. "A title was solicited and none
  // was forthcoming" beats putting words in a five-month-old's mouth every time.
  //
  // Everything here is static on purpose — the family, the rules, the register. The
  // per-drawing facts go in the user turn below, which keeps this block identical
  // between calls. See the note on caching where it is sent.
  const SYSTEM = [
    'You write wall labels for a museum whose permanent collection is the work of Finn,',
    'a baby. The museum is deadpan: it treats the collection with exactly the seriousness',
    'it would give any other artist, and the comedy comes entirely from that seriousness',
    'being applied to the life of an infant. Never wink. No exclamation marks. Never call',
    'anything adorable.',
    '',
    'Two or three sentences. Sixty words at most.',
    '',
    'DO NOT DESCRIBE THE PICTURE. The visitor is standing in front of it. Use what you can',
    'see to invent an ANECDOTE about the work — how it was commissioned, how the sitting',
    'went, how it was received in the house, what the artist was doing instead.',
    '',
    'The anecdote need not be true. It must be dry, specific and plausible, and grounded',
    'in these:',
    '  - The artist is Finn. His parents are Adam and Catherine.',
    '  - His older sister is Babka, a tortoiseshell cat born September 2022.',
    '  - Anchor at least one detail to what a baby of the stated age can and cannot do:',
    '    rolling over, grabbing his feet, mouthing everything, babbling in vowels,',
    '    holding his head up, sleeping through things.',
    '',
    'Not everything in this collection was made by Finn — some of it was made for him, or',
    'around him, or by a machine. Where he plainly did not hold the brush, do not pretend',
    'he did; that he attended and contributed by sleeping through it is the better line.',
    '',
    'Never invent a quotation from Finn. He cannot speak, and that he cannot speak is',
    'almost always the better joke.',
    'Do not invent other relatives, places, or anything medical.',
    'Return the label text and nothing else.',
  ].join('\n');

  const facts = [
    body.title ? `Title: ${body.title}` : 'Title: untitled',
    body.medium ? `Medium: ${body.medium}` : null,
    body.dimensions ? `Dimensions: ${body.dimensions}` : null,
    body.createdOn ? `Made on: ${body.createdOn}` : null,
    body.age ? `The artist was ${body.age} old.` : null,
    body.note ? `What the parent wrote, which the label should build on rather than contradict: ${body.note}` : null,
  ].filter(Boolean).join('\n');

  let res;
  try {
    res = $http.send({
      url: ENDPOINT,
      method: 'POST',
      timeout: 120,
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        // Marked cacheable, and currently INERT — say so plainly rather than let the
        // next person assume it is saving anything. Anthropic will not create a cache
        // entry below 1024 tokens and this block is roughly a third of that, so the
        // marker does nothing today. It costs nothing either, and the moment the prompt
        // grows past the minimum it starts working with no code change. The other half
        // of why caching is the wrong tool here: entries live about five minutes, and
        // this endpoint is pressed a few times a month.
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: `${facts}\n\nWrite the wall label.` },
          ],
        }],
      }),
    });
  } catch (err) {
    // A failure here is almost always the runtime not being able to reach the internet,
    // which is worth saying out loud rather than reporting as a generic 500.
    throw new ApiError(502, `Could not reach the model: ${err}`, null);
  }

  if (res.statusCode !== 200) {
    const detail = String(res.raw || '').slice(0, 300);
    throw new ApiError(502, `The model refused (${res.statusCode}). ${detail}`, null);
  }

  const parsed = res.json || {};
  const text = (parsed.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (!text) throw new ApiError(502, 'The model returned nothing.', null);

  return e.json(200, { note: text, model: MODEL });
}, $apis.requireAuth());
