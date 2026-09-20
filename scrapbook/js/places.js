// Turning coordinates into the name of a town.
//
// ENTIRELY ON THE DEVICE. No geocoding service, no API key, nothing told to anybody about
// where a family's photographs were taken. The cost is a list of places to search, and the
// whole design here is about making that list small enough to be worth carrying.
//
// The list is 34,000 towns of 15,000 people or more — 838 KB, which is far too much to
// send to look up one photograph. So it is cut into ten-degree tiles: a lookup fetches the
// square of the world it happened in and, where it is near an edge, the neighbours. The
// median tile is 1.3 KB. An index says which tiles exist at all, so the Pacific costs
// nothing.
//
// Nothing here loads until a photograph with coordinates is actually added — this module
// is imported dynamically, so a family looking at their timeline never fetches any of it.
//
// Place data from GeoNames (geonames.org), CC BY 4.0.

const ROOT = '/assets/places-1';
const TILE = 10;                 // degrees per side
/** Past this, "the nearest town" stops being where you were. */
const TOO_FAR_KM = 120;

let indexPromise = null;
const tiles = new Map();         // "la,lo" -> [place] — kept for the life of the page

/** Which tiles hold anything, so empty ocean is never requested. */
async function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(`${ROOT}/index.txt`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => new Set(text.split(/\s+/).filter(Boolean)))
      .catch(() => new Set());
  }
  return indexPromise;
}

/** One tile's towns, parsed once and kept. */
async function loadTile(key) {
  if (tiles.has(key)) return tiles.get(key);
  const pending = fetch(`${ROOT}/${key.replace(',', '_')}.txt`)
    .then((r) => (r.ok ? r.text() : ''))
    .then((text) => text.split('\n').filter(Boolean).map((line) => {
      const [name, country, region, lat, lon] = line.split('|');
      return { name, country, region, lat: Number(lat) / 100, lon: Number(lon) / 100 };
    }))
    .catch(() => []);
  tiles.set(key, pending);
  return pending;
}

/** Kilometres between two points, near enough at the scale of a town. */
function distanceKm(aLat, aLon, bLat, bLon) {
  // Equirectangular rather than haversine: over the tens of kilometres that matter here
  // the difference is metres, and this is run against a few thousand candidates.
  const meanLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dLat = (bLat - aLat) * 111.32;
  const dLon = (bLon - aLon) * 111.32 * Math.cos(meanLat);
  return Math.sqrt((dLat * dLat) + (dLon * dLon));
}

/** The tile a point falls in, and its neighbours — a town may be over the edge. */
export function tilesAround(lat, lon) {
  const la = Math.floor(lat / TILE);
  const lo = Math.floor(lon / TILE);
  const keys = [];
  for (let dla = -1; dla <= 1; dla += 1) {
    for (let dlo = -1; dlo <= 1; dlo += 1) {
      // Longitude wraps; latitude does not.
      const wrapped = (((lo + dlo) + 18) % 36 + 36) % 36 - 18;
      keys.push(`${la + dla},${wrapped}`);
    }
  }
  return [...new Set(keys)];
}

/**
 * The nearest town to a point, or null if there is nothing near enough.
 *
 * @returns {Promise<{name, region, country, km}|null>}
 */
export async function placeFor(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const have = await loadIndex();
  const wanted = tilesAround(lat, lon).filter((key) => have.size === 0 || have.has(key));
  if (!wanted.length) return null;

  const loaded = await Promise.all(wanted.map(loadTile));
  let best = null;
  for (const towns of loaded) {
    for (const town of towns) {
      const km = distanceKm(lat, lon, town.lat, town.lon);
      if (!best || km < best.km) best = { ...town, km };
    }
  }
  // A town 300km away is not where the photograph was taken; saying so would be worse
  // than saying nothing.
  return best && best.km <= TOO_FAR_KM ? best : null;
}
