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
  // Which model writes the label.
  //
  // The env var sets the default without a deploy. The request may also name one, but
  // only from this list — an endpoint that forwards whatever string it is handed to a
  // paid API is a bill waiting to happen, and an allowlist costs one line. The point of
  // the per-request override is being able to put two models side by side on the SAME
  // drawing, which is the only honest way to compare how they write.
  const ALLOWED = ['claude-opus-5', 'claude-sonnet-5'];
  const asked = String((e.requestInfo().body || {}).model || '');
  const MODEL = ALLOWED.indexOf(asked) >= 0
    ? asked
    : ($os.getenv('ANTHROPIC_MODEL') || 'claude-opus-5');
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
  // ── Why there is an ANGLE, picked at random ──────────────────────────────
  // The first version of this prompt handed the model the family as its grounding
  // facts, and got back ten labels that were all the same label: "Commissioned by
  // [parent] … the artist contributed by [milestone] … Babka [did something]". Four of
  // six opened with the word "Commissioned". Asking for variety does not produce it —
  // the model reaches for the strongest pattern in the prompt every time.
  //
  // So the variety is imposed from outside rather than requested. One angle is drawn
  // per call from a list of the things real wall text actually does — provenance,
  // condition, exhibition history, attribution disputes, curatorial hedging — and the
  // label has to take that angle. Two labels written a minute apart now differ because
  // they were asked different questions, not because the sampler happened to wander.
  const ANGLES = [
    'A conservation note: the physical condition of the work, what has happened to it since, and what the studio has decided to do about it.',
    'Provenance: how the work came into the collection, and where it had been before that.',
    'Exhibition history: where this has previously been displayed, and how it was received there.',
    'The circumstances of its making — the room, the hour, what else was going on.',
    'Technique and materials, described with more rigour than they can possibly bear.',
    'A question of attribution: how much of this is actually the artist\'s own work, and how the studio has settled the matter.',
    'Its reception: what happened when the work was first shown, and to whom.',
    'A comparison with the artist\'s earlier work, and what it shows about the direction of his practice.',
    'A scholarly disagreement — about the dating, the subject, or the intent — that remains unresolved.',
    'An incident that occurred during or shortly after the work was made.',
    'What the artist was doing INSTEAD, while the work was being completed.',
    'A note on the work\'s title, or the absence of one.',
  ];
  const ANGLE = ANGLES[Math.floor(Math.random() * ANGLES.length)];

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
    'see as raw material for something else — an anecdote, a note, a small institutional',
    'fuss. The anecdote need not be true, but it must be dry, specific and plausible.',
    '',
    'WHO IS IN THE ARTIST\'S LIFE:',
    '  - Finn is in daycare. If the work needed adult hands, they were most likely an',
    '    instructor\'s — unnamed, or named with an initial and treated as staff. The room,',
    '    the routine, the other infants and the daily report are all fair material.',
    '  - His parents are Adam and Catherine. His elder sister is Babka, a tortoiseshell',
    '    cat born September 2022.',
    '',
    'USE THE FAMILY SPARINGLY. They have been badly overused. Most labels should mention',
    'none of them. Never mention more than one of them in a single label, and only when',
    'that particular label genuinely needs them — a work made at home, a reception, a',
    'question of who was holding the brush. The daycare and the institution itself are the',
    'default cast; the family is the exception.',
    '',
    'Anchor at least one detail to what a baby of the stated age can and cannot do, and be',
    'specific to that age rather than reaching for the same few: at six months, sitting',
    'propped, rolling both ways, transferring an object hand to hand, mouthing everything,',
    'consonants arriving, unable to be left on anything raised.',
    '',
    'DO NOT begin the label with "Commissioned by". Vary how you open — a date, a',
    'condition, a disagreement, a fact about the room. Avoid the formula of naming a',
    'commissioner, then a milestone, then the cat.',
    '',
    'Not everything in this collection was made by Finn — some of it was made for him, or',
    'around him, or by a machine. Where he plainly did not hold the brush, do not pretend',
    'he did; that he attended and slept through it is the better line.',
    '',
    'Never invent a quotation from Finn. He cannot speak, and that he cannot speak is',
    'almost always the better joke.',
    'Do not invent other relatives, or anything medical.',
    'Return the label text and nothing else — no title, no heading, no medium line.',
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
            { type: 'text', text: `${facts}\n\nTake this angle for this label:\n${ANGLE}\n\nWrite the wall label.` },
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

  if (!text) {
    // "The model returned nothing" is unactionable, and it happens: a 200 can come back
    // with no text in it. The reason is in stop_reason and in what the content blocks
    // actually were, so say both. A refusal and a truncation look identical from here
    // otherwise, and they want completely different fixes.
    const why = parsed.stop_reason || 'no stop_reason';
    const kinds = (parsed.content || []).map((part) => part.type).join(', ') || 'no content blocks';
    throw new ApiError(502,
      `The model returned no text (stop_reason: ${why}; blocks: ${kinds}).`, null);
  }

  return e.json(200, { note: text, model: MODEL });
}, $apis.requireAuth());
