export const MINUTE = 60_000;
export const POLICY = Object.freeze({
  activities: ['coffee', 'food', 'chat'],
  responseWindowMs: 45_000,
  departureBufferMs: MINUTE,
  commitmentBufferMs: 5 * MINUTE,
  minimumTogetherMs: 10 * MINUTE,
  maximumTogetherMs: 25 * MINUTE,
  chatGraceMs: 10 * MINUTE,
  retentionMs: 24 * 60 * MINUTE,
  maximumGroup: 4,
  matchingPoolLimit: 100,
  autoRadiusMeters: 40,
  autoMaxAccuracyMeters: 25,
  autoMaxFixAgeMs: 15_000,
  autoDwellMs: 10_000,
});

export class PulseError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function requireThat(condition, code, message) {
  if (!condition) throw new PulseError(code, message);
}
export function millis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : Number(value);
}
export function validId(value, label = 'ID') {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'invalid-argument', `Invalid ${label}.`);
  return value;
}
export function point(value) {
  requireThat(value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180,
  'invalid-argument', 'A valid position is required.');
  return { latitude: value.latitude, longitude: value.longitude };
}
export function distanceMeters(a, b) {
  const r = Math.PI / 180, dLat = (b.latitude - a.latitude) * r, dLon = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function validateFix(value, now, maxAge = 30_000, maxAccuracy = 100) {
  const location = point(value);
  requireThat(Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= maxAccuracy,
    'failed-precondition', 'Location is too approximate. Use manual location or check-in.');
  requireThat(Number.isFinite(value.capturedAt) && now - value.capturedAt <= maxAge && value.capturedAt <= now + 5_000,
    'failed-precondition', 'A fresh location reading is required.');
  return { ...location, accuracy: value.accuracy, capturedAt: value.capturedAt };
}
export function withinBounds(location, bounds) {
  return Array.isArray(bounds) && bounds.length === 4
    && location.latitude >= bounds[0] && location.longitude >= bounds[1]
    && location.latitude <= bounds[2] && location.longitude <= bounds[3];
}
export function usableSpot(spot) {
  return !!spot && spot.enabled === true && spot.verified === true
    && typeof spot.instruction === 'string' && spot.instruction.trim().length > 0
    && Array.isArray(spot.activities) && Number.isFinite(spot.latitude) && Number.isFinite(spot.longitude);
}
export function walkingMinutes(availability, spot) {
  // Conservative straight-line estimate, not a routed walk or next-class guarantee.
  const meters = distanceMeters(availability.location, spot) * 1.35 + (availability.location.accuracy || 0);
  return Math.max(1, Math.ceil(meters / 1.2 / 60));
}
export function makePlan(people, spot, activity, now, proposedStart = null, proposedEnd = null) {
  if (people.length < 2 || people.length > POLICY.maximumGroup || !usableSpot(spot)) return null;
  if (!spot.activities.includes(activity) || !people.every(p => p.activities.includes(activity) && p.location && millis(p.expiresAt) > now)) return null;
  const walks = Object.fromEntries(people.map(p => [p.uid, walkingMinutes(p, spot)]));
  if (!people.every(p => walks[p.uid] <= p.maxWalkMinutes)) return null;
  const travelStart = now + POLICY.departureBufferMs + Math.max(...Object.values(walks)) * MINUTE;
  const startsAt = proposedStart == null ? travelStart + POLICY.responseWindowMs : Math.max(proposedStart, travelStart);
  const endsAt = Math.min(startsAt + POLICY.maximumTogetherMs,
    ...people.map(p => millis(p.expiresAt) - POLICY.commitmentBufferMs), proposedEnd ?? Infinity);
  if (endsAt - startsAt < POLICY.minimumTogetherMs) return null;
  return { startsAt, endsAt, walks };
}
export function validateAutomaticArrival(fixes, spot, now, confirmedAt) {
  requireThat(Array.isArray(fixes) && fixes.length === 2, 'invalid-argument', 'Two fresh location readings are required.');
  const validated = fixes.map(f => validateFix(f, now, POLICY.autoMaxFixAgeMs, POLICY.autoMaxAccuracyMeters));
  requireThat(validated[0].capturedAt >= confirmedAt && validated[1].capturedAt - validated[0].capturedAt >= POLICY.autoDwellMs,
    'failed-precondition', 'Wait near the meeting point for a fresh arrival reading.');
  requireThat(validated.every(f => distanceMeters(f, spot) + f.accuracy <= POLICY.autoRadiusMeters),
    'failed-precondition', 'Your location does not yet place you close enough to the meeting point.');
  return true;
}
