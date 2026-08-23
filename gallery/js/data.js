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

export const SOURCE = 'static';

const impl = SOURCE === 'pocketbase' ? pocketbase : staticJson;

export const { getGallery } = impl;
