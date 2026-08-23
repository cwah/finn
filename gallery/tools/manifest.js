// Manifest stubs for whatever is sitting in art/.
//
//   node tools/manifest.js
//
// Dev tooling. Never served, never imported by the app.
//
// It exists because there is no build step: every dimension in data/artworks.json is
// typed by a person, the layout is chosen entirely from those numbers, and a wrong
// one is invisible — the frame simply comes out the wrong shape. So the numbers are
// measured rather than typed, and only the words are left to write.
//
// It prints; it does not edit data/artworks.json. Rewriting the manifest would mean
// owning the prose in it too, and the prose is the point of the site.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { imageSize } from './image-size.js';

const ART = 'art';
const MANIFEST = 'data/artworks.json';
const READABLE = new Set(['.jpg', '.jpeg', '.png', '.svg']);

/** A filename like 2026-05-02-tyrannosaurus.svg -> its date and a slug id. */
function fromName(file) {
  const stem = basename(file, extname(file));
  const dated = /^(\d{4}-\d{2}-\d{2})[-_](.+)$/.exec(stem);
  return dated
    ? { createdOn: dated[1], id: dated[2] }
    : { createdOn: null, id: stem };
}

const known = existsSync(MANIFEST)
  ? new Set(JSON.parse(readFileSync(MANIFEST, 'utf8')).artworks.map((a) => a.image?.src))
  : new Set();

const files = readdirSync(ART)
  .filter((f) => READABLE.has(extname(f).toLowerCase()))
  .sort()
  .reverse();   // newest first, the order the manifest is written in

const stubs = [];
for (const file of files) {
  const src = `${ART}/${file}`;
  if (known.has(src)) continue;

  const size = imageSize(readFileSync(join(ART, file)));
  if (!size) {
    console.error(`  ?  ${file} — could not be measured; add its size by hand`);
    continue;
  }
  const { createdOn, id } = fromName(file);
  if (size.orientation && size.orientation >= 5) {
    console.error(`  i  ${file} — EXIF says it is rotated; dimensions swapped to match`);
  }

  stubs.push({
    id,
    title: 'Untitled',
    createdOn: createdOn ?? 'YYYY-MM-DD',
    yearLabel: null,
    medium: null,
    dimensions: null,
    note: null,
    image: { src, width: size.width, height: size.height },
    alt: null,
    frame: null,
    accession: null,
  });
}

if (stubs.length === 0) {
  console.error(`\n  Nothing new in ${ART}/ — every file is already in the manifest.\n`);
} else {
  console.error(`\n  ${stubs.length} new, newest first. Paste into "artworks" and write the words:\n`);
  console.log(stubs.map((s) => JSON.stringify(s, null, 2)).join(',\n'));
}
