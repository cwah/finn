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

  // The wall label itself. Two things in here are load-bearing rather than stylistic.
  //
  // The artist is a baby. He cannot have said anything about his work, so the model is
  // told plainly never to invent what he said, meant or felt — the parody only works
  // while every fact on the label is true, and a fabricated quotation from a real child
  // is not a small thing to hang on a wall and keep.
  //
  // And it must describe what is actually in the picture rather than what the title
  // suggests, which is the whole reason the image is sent at all.
  const SYSTEM = [
    'You write wall labels for a museum whose permanent collection is the artwork of a',
    'small child. The museum is entirely sincere: it treats the work with the same',
    'seriousness it would give any other artist. Never wink at the reader, never be',
    'arch, never be cute about the fact that the artist is a baby.',
    '',
    'Write two to four sentences, sixty words at most, in the plain curatorial register',
    'of a gallery label. Describe what is actually visible in the image — the marks, the',
    'colours, how the surface was worked — and situate it in the artist\'s practice.',
    '',
    'Absolute rules:',
    '- NEVER invent what the artist said, thought, intended, felt or remembers. He is an',
    '  infant and has said nothing about this work. No quotations, no "the artist',
    '  explains", no attributed intent.',
    '- NEVER invent biographical facts, dates, places, family members or events. Use only',
    '  what you are given.',
    '- If something is genuinely unclear in the image, describe it as it appears rather',
    '  than guessing what it depicts.',
    '- No title, no heading, no preamble. Return the label text and nothing else.',
  ].join('\n');

  const facts = [
    body.title ? `Title: ${body.title}` : 'Title: untitled',
    body.medium ? `Medium: ${body.medium}` : null,
    body.dimensions ? `Dimensions: ${body.dimensions}` : null,
    body.createdOn ? `Made on: ${body.createdOn}` : null,
    body.age ? `The artist was ${body.age} old.` : null,
    body.note ? `The parent's own words, which the label should build on rather than\ncontradict: ${body.note}` : null,
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
        system: SYSTEM,
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
