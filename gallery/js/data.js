// Where the collection comes from.
//
// The entire backend swap is the one constant below. Everything downstream imports
// from this file and never from a source directly, so the frontend consumes the JSON
// contract (see CLAUDE.md) and nothing else — it has no idea whether a drawing came
// out of a file on disk or a PocketBase record.
//
// Copied wholesale from scrapbook/js/data.js, which does the same job for the same
// reason. Flip SOURCE to 'pocketbase' when the backend is ready; nothing else moves.

import * as staticJson from './data-static.js';
import * as pocketbase from './data-pb.js';

// PocketBase is the collection now. 'static' still works and is what data-static.js
// plus data/artworks.json are for — a no-backend mode for working on the wall, the
// frames or the placard without running a server, the same job scrapbook's mock.json
// does. The five drawings in that manifest are placeholders and are NOT the real
// collection; nothing seeds them into PocketBase on purpose, because their labels are
// invented and this gallery is a real one.
export const SOURCE = 'pocketbase';

const impl = SOURCE === 'pocketbase' ? pocketbase : staticJson;

export const { getGallery } = impl;
