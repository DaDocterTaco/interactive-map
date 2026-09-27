import { NavigationError, point, abortIfNeeded } from './geometry.js';

/** Normalize known formats. Bare arrays require an explicitly selected order. */
export function normalizeLocation(input, { arrayOrder } = {}, depth = 0) {
  if (depth > 6) throw new NavigationError('INVALID_LOCATION', 'Location nesting is too deep.');
  const next = value => normalizeLocation(value, { arrayOrder }, depth + 1);
  if (typeof input === 'string') {
    const parts = input.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
    if (parts) return point({ lat: Number(parts[1]), lng: Number(parts[2]) });
    throw new NavigationError('UNRESOLVED_LOCATION', 'Resolve this place name or address to coordinates first.');
  }
  if (Array.isArray(input)) {
    if (!['latlng', 'lnglat'].includes(arrayOrder) || input.length !== 2) {
      throw new NavigationError('INVALID_LOCATION', 'Coordinate arrays need arrayOrder: latlng or lnglat.');
    }
    return point({ lat: input[arrayOrder === 'latlng' ? 0 : 1], lng: input[arrayOrder === 'latlng' ? 1 : 0] });
  }
  if (!input || typeof input !== 'object') return point(input);
  if ('lat' in input || 'latitude' in input) return point(input);
  if (input.type === 'Feature') return next(input.geometry);
  if (input.type === 'Point') {
    if (!Array.isArray(input.coordinates) || input.coordinates.length < 2) return point(null);
    return point({ lat: input.coordinates[1], lng: input.coordinates[0] });
  }
  if (typeof input.getLatLng === 'function') return next(input.getLatLng());
  for (const key of ['coords', 'fix', 'location', 'position', 'building', 'latLng']) {
    if (input[key] !== undefined && input[key] !== null) return next(input[key]);
  }
  throw new NavigationError('INVALID_LOCATION', 'This location format needs a custom resolver.');
}

const keyFor = value => String(value).trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');

/** Local exact-name/code lookup, with an optional application-owned geocoder. */
export function createLocationResolver({ places = [], resolveText, arrayOrder } = {}) {
  const lookup = new Map();
  for (const place of places) {
    const location = normalizeLocation(place, { arrayOrder });
    for (const alias of [place.id, place.name, place.abbreviation, ...(place.aliases || [])]) {
      if (alias === undefined || alias === null || keyFor(alias) === '') continue;
      const key = keyFor(alias), prior = lookup.get(key);
      // A duplicate name is safe only when it points to the same location.
      lookup.set(key, prior === null || prior && (prior.lat !== location.lat || prior.lng !== location.lng) ? null : location);
    }
  }
  return async (input, { signal } = {}) => {
    abortIfNeeded(signal);
    try { return normalizeLocation(input, { arrayOrder }); }
    catch (error) {
      if (error.code !== 'UNRESOLVED_LOCATION') throw error;
    }
    const text = input.trim(), key = keyFor(text);
    if (!key) throw new NavigationError('INVALID_LOCATION', 'Enter a location.');
    if (lookup.has(key)) {
      if (!lookup.get(key)) throw new NavigationError('AMBIGUOUS_LOCATION', 'This name matches several locations. Choose a specific place.');
      return { ...lookup.get(key) };
    }
    if (!resolveText) throw new NavigationError('UNRESOLVED_LOCATION', 'Unknown place. Supply coordinates or configure an address resolver.');
    const resolved = await resolveText(text, { signal });
    abortIfNeeded(signal);
    return normalizeLocation(resolved, { arrayOrder });
  };
}

/** No fetch until a caller actually supplies a name rather than coordinates. */
export function createCampusLocationResolver({ catalogUrl = new URL('./data/campus-places.json', import.meta.url),
  fetchImpl = globalThis.fetch, resolveText, arrayOrder } = {}) {
  let loaded;
  return async (input, { signal } = {}) => {
    abortIfNeeded(signal);
    try { return normalizeLocation(input, { arrayOrder }); }
    catch (error) { if (error.code !== 'UNRESOLVED_LOCATION') throw error; }
    if (!loaded) loaded = Promise.resolve().then(async () => {
      try {
        const response = await fetchImpl(catalogUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return createLocationResolver({ places: data.places, resolveText, arrayOrder });
      } catch (error) {
        loaded = undefined;
        throw new NavigationError('DATA_UNAVAILABLE', `Could not load campus places: ${error.message}`);
      }
    });
    const resolve = await loaded;
    abortIfNeeded(signal);
    return resolve(input, { signal });
  };
}
