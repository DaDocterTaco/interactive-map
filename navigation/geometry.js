export class NavigationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NavigationError';
    this.code = code;
  }
}

/** Named coordinates prevent accidental Leaflet/GeoJSON array-order swaps. */
export function point(value) {
  const lat = value?.lat ?? value?.latitude;
  const lng = value?.lng ?? value?.longitude ?? value?.lon;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 ||
      !Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new NavigationError('INVALID_LOCATION', 'Use a location with valid numeric lat and lng.');
  }
  return { lat, lng };
}

const rad = Math.PI / 180;
export function distance(a, b) {
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}

/** Local tangent-plane projection, intended for campus-scale path segments. */
export function project(p, a, b) {
  const scale = Math.cos(p.lat * rad);
  const dx = (b.lng - a.lng) * scale;
  const dy = b.lat - a.lat;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    (((p.lng - a.lng) * scale) * dx + (p.lat - a.lat) * dy) / denominator));
  const location = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
  return { t, location, offsetMeters: distance(p, location) };
}

export function abortIfNeeded(signal) {
  if (signal?.aborted) throw new NavigationError('ABORTED', 'Route request cancelled.');
}
