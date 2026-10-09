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
  // What is already on the wall, sent by the studio. The single biggest cause of
  // repetition is that every call is blind to every other one, so the model converges on
  // the same phrasing for the same angle. Capped, because this grows forever and the
  // oldest labels are the least likely to be read alongside the new one.
  const existing = Array.isArray(body.existing)
    ? body.existing.filter(Boolean).slice(0, 12).map((s) => `- ${String(s).slice(0, 400)}`).join('\n')
    : '';
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
    'The occasion the work was made for, and what that occasion actually means.',
    'The story, myth, tradition or custom behind what is depicted — told properly, as something worth knowing.',
    'A genuine ambiguity in the work that was never resolved, and is now left to the viewer.',
    'A question nobody thought to ask at the time, and no longer can.',
    'What this is the first of, in a practice six months old.',
    'How it was received by someone who saw it — and what they made of it.',
    'The circumstances of its making: the room, the hour, what else was going on.',
    'What the artist was doing INSTEAD while the work was being finished.',
    'A note on the title, or on the absence of one.',
    'How the work came into the collection, and where it had been before.',
    'A conservation note: what has happened to the object since, and what was decided about it.',
    'A disagreement about the work that remains unsettled.',
  ];
  const ANGLE = ANGLES[Math.floor(Math.random() * ANGLES.length)];

  // Angle alone was not enough. Two labels that drew the conservation angle came back
  // nearly word for word — both "consistent with sustained mouthing", both declining to
  // intervene — because the angle fixes the SUBJECT and leaves the sentence shapes free
  // to converge. This fixes the shape too, so even a repeated angle has to be built
  // differently.
  const SHAPES = [
    'Keep it to a single sentence.',
    'Two or three sentences.',
    'Two short paragraphs: the first about this object, the second about the thing behind it.',
    'A short opening statement, then a longer passage that goes somewhere unexpected.',
    'Three sentences. Make the last one quiet rather than clever.',
    'As long as the material genuinely deserves, and no longer.',
  ];
  const SHAPE = SHAPES[Math.floor(Math.random() * SHAPES.length)];

  const SYSTEM = [
    'You write wall labels for a museum whose permanent collection is the work of Finn,',
    'a baby. The museum is entirely sincere. It treats the work with the seriousness it',
    'would give any other artist, and it is warm about it rather than arch — the joke, as',
    'far as there is one, is that nobody involved is joking. Never wink. No exclamation',
    'marks. Never call anything adorable.',
    '',
    '── THE STANDARD ─────────────────────────────────────────────────────────────',
    'Two labels written by the artist\'s parents. These are the target. Read what they do.',
    '',
    'For a Mid-Autumn Festival collage:',
    '  "Created to celebrate the artist\'s first Mid-Autumn Festival, the piece depicts the',
    '  mythical Moon Rabbit who can be seen in the shadows of the full harvest moon.',
    '',
    '  Legend has it that the Jade Emperor wanted to find a loyal creature to help create',
    '  the elixir of immortality. Disguising himself as a starving traveler on Earth, he',
    '  asked forest animals for assistance. The rabbit chose to offer itself as food, and',
    '  touched by this ultimate act of compassion, the Jade Emperor granted the rabbit',
    '  eternal life and sent it to the lunar realm, where it spends eternity using a mortar',
    '  and pestle to pound the elixir of life."',
    '',
    'For a painting of red shapes:',
    '  "It was never clarified with the artist whether this piece depicts flowers or',
    '  ladybugs; when asked about it, the artist ignored the question and turned his',
    '  attention to his crinkly book instead. The question remains unresolved and is left',
    '  for viewer interpretation."',
    '',
    'What those do, and what you must do:',
    '  - They are ABOUT SOMETHING. The first spends most of its length on a myth that has',
    '    nothing to do with the paint on the paper, and is the better for it. Go outside',
    '    the museum. Culture, season, festival, story, custom, family occasion — if the',
    '    work touches one, that is the label.',
    '  - They are warm, and they are not bureaucratic. Neither one mentions a height in',
    '    centimetres, a date range, or a corridor. Logistics are the weakest thing a label',
    '    can be about; reach for them last, if at all.',
    '  - The second invents a whole small scene — a question asked, ignored, a crinkly book',
    '    — and it is specific and true to a six-month-old. Inventing is the job.',
    '  - They are as long as they need to be and no longer. One is a paragraph and a half.',
    '    One is three sentences.',
    '',
    '── LENGTH ───────────────────────────────────────────────────────────────────',
    'Anywhere from one sentence to two short paragraphs. Let the material decide. A piece',
    'with a real occasion or a real story behind it has earned the room; a piece with',
    'little to say should be short rather than padded out to look substantial.',
    '',
    '── IF A NOTE IS SUPPLIED, IT OUTRANKS EVERYTHING ────────────────────────────',
    'A parent has written down something that actually happened — the occasion, what it',
    'was for, who was there, what it was like. That is the only true thing you have and it',
    'is worth more than anything you can infer from looking. Build the label out of it:',
    'take what it says and carry it somewhere, elaborate it, give it consequences, tell',
    'the story standing behind it. Do not merely avoid contradicting it, and do not repeat',
    'it back. Treat it as the seed and the label as what grew.',
    '',
    'Where no note is supplied, invent freely; the latitude is wider, not narrower.',
    '',
    '── DO NOT INVENTORY THE PICTURE ─────────────────────────────────────────────',
    'The visitor is standing in front of it and can see it perfectly well. Never count',
    'what is in it, never name its colours, never work out which marks are the artist\'s',
    'and which are not, never walk the eye across it. A label that catalogues the image',
    'has wasted the only thing a label is for. Look at the picture, understand what it is',
    'of, and then write about something else.',
    '',
    '── WHO IS IN THE ARTIST\'S LIFE ──────────────────────────────────────────────',
    '  - Finn is in daycare. Where a work needed adult hands they were most likely an',
    '    instructor\'s — unnamed, or named with an initial and treated as staff.',
    '  - His parents are Adam and Catherine. His elder sister is Babka, a tortoiseshell',
    '    cat born September 2022. USE THESE SPARINGLY. Most labels should name none of',
    '    them, and never more than one in a single label.',
    '',
    'Where it is relevant, anchor a detail to what a baby of the stated age can and cannot',
    'do: at six months, sitting propped, rolling both ways, transferring an object hand to',
    'hand, mouthing everything, consonants arriving, grabbing what comes within range.',
    '',
    '── WORN-OUT PHRASING ────────────────────────────────────────────────────────',
    'All used already. Do not reuse them or reach for near-variants:',
    '  - "consistent with sustained mouthing", and any "consistent with ..." formulation',
    '  - every way of saying the museum left something alone: "has declined to intervene",',
    '    "elected not to", "the studio has decided"',
    '  - "at [N] months the artist cannot yet ...", as a clause explaining a limitation',
    '  - "the studio maintains", "his file notes without further comment"',
    '  - "attended and contributed by sleeping through it"',
    '  - hanging heights in centimetres, and date ranges of the form "from X to Y"',
    '',
    'Never invent a quotation from Finn. He cannot speak. Describing what he DID — ignored',
    'the question, turned to his crinkly book — is not only allowed, it is the good stuff.',
    'Do not invent other relatives, or anything medical.',
    'Return the label text and nothing else — no title, no heading, no medium line.',
  ].join('\n');

  const facts = [
    body.title ? `Title: ${body.title}` : 'Title: untitled',
    body.medium ? `Medium: ${body.medium}` : null,
    body.dimensions ? `Dimensions: ${body.dimensions}` : null,
    body.createdOn ? `Made on: ${body.createdOn}` : null,
    body.age ? `The artist was ${body.age} old.` : null,
    // NOT the parent's note — that goes in on its own below, because buried here among
    // five other fields it read as one more constraint rather than as the thing the
    // label is supposed to be made of.
    null,
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
        // Room to think, not room to ramble. The label itself is capped at sixty words
        // by the prompt, so 400 looked generous — but the model returns THINKING blocks
        // before its answer, and they are billed against the same budget. A label would
        // sometimes come back empty with stop_reason: max_tokens and nothing but
        // thinking in it, which is what the diagnostic above was added to catch and
        // caught on its first outing. This is headroom for the reasoning, not a licence
        // for a longer label.
        max_tokens: 3000,
        // Cacheable, and — as of the rewrite around the two worked examples — finally
        // big enough to be cached: ~1288 tokens against Anthropic's 1024 minimum. This
        // marker sat here inert for months at ~370 tokens, on the grounds that it cost
        // nothing and would start working if the prompt ever grew. It grew.
        //
        // Whether it SAVES much is a separate question, and mostly no: entries live
        // about five minutes and this endpoint is pressed a few times a month, so most
        // calls still pay full price. It earns its keep in a sitting where several
        // drawings are labelled one after another, which is how a backlog gets cleared.
        //
        // The per-drawing facts, the angle, the shape and the existing labels all ride
        // in the USER turn precisely so this block stays byte-identical between calls.
        // Anything moved up here that varies per request silently switches caching off.
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: [
              facts,
              '',
              body.note
                ? `WHAT THE PARENT WROTE. This actually happened, and it outranks anything you can see in the picture. Build the label out of it — carry it somewhere, give it consequences, invent what grew up around it. Do not repeat it back and do not merely avoid contradicting it:\n\n${body.note}`
                : 'No note was supplied, so invent freely.',
              '',
              existing ? `Labels already hanging in this museum. Do not reuse their phrasing, their sentence shapes, or their closing moves — a visitor reads these one after another:\n${existing}` : '',
              '',
              `Take this angle for this label:\n${ANGLE}`,
              `Shape: ${SHAPE}`,
              '',
              'Write the wall label.',
            ].filter(Boolean).join('\n') },
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
