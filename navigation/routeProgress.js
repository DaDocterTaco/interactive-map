import { distance, point, project, NavigationError } from './geometry.js';

/** Prepared once per route; measures progress without re-running route search. */
export function createRouteProgress(route) {
  if (route?.geometry?.type !== 'LineString' || !Array.isArray(route.geometry.coordinates) ||
      route.geometry.coordinates.length < 2 || !Number.isFinite(route.distanceMeters) || route.distanceMeters < 0 ||
      !Number.isFinite(route.durationSeconds) || route.durationSeconds < 0) {
    throw new NavigationError('INVALID_ROUTE', 'Live navigation needs a valid LineString route with distance and time.');
  }
  const points = route.geometry.coordinates.map(([lng, lat]) => point({ lat, lng }));
  let total = 0;
  const segments = points.slice(1).map((b, i) => {
    const a = points[i], length = distance(a, b), start = total;
    total += length;
    return { a, b, length, start };
  });
  const scale = total > 0 ? route.distanceMeters / total : 0;
  if (!total && route.distanceMeters > 0) throw new NavigationError('INVALID_ROUTE', 'Nonzero routes need nonzero geometry.');
  const validSteps = Array.isArray(route.steps) && route.steps.every(s => Number.isFinite(s.distanceMeters) &&
    s.distanceMeters >= 0 && Number.isFinite(s.durationSeconds) && s.durationSeconds >= 0) &&
    Math.abs(route.steps.reduce((sum, s) => sum + s.distanceMeters, 0) - route.distanceMeters) < 1 &&
    Math.abs(route.steps.reduce((sum, s) => sum + s.durationSeconds, 0) - route.durationSeconds) < 1;
  function remainingSeconds(travelled) {
    if (!validSteps) return route.distanceMeters ? route.durationSeconds * (1 - travelled / route.distanceMeters) : 0;
    let skipped = travelled, seconds = 0;
    for (const step of route.steps) {
      const fraction = step.distanceMeters ? Math.max(0, 1 - skipped / step.distanceMeters) : 0;
      seconds += step.durationSeconds * fraction;
      skipped = Math.max(0, skipped - step.distanceMeters);
    }
    return seconds;
  }
  return (position, { previousDistance = null, maxProgressDelta = Infinity } = {}) => {
    const candidates = segments.map(s => {
      const p = project(position, s.a, s.b);
      return { ...p, distanceTravelledMeters: (s.start + p.t * s.length) * scale };
    });
    const plausible = previousDistance === null ? candidates : candidates.filter(c =>
      Math.abs(c.distanceTravelledMeters - previousDistance) <= maxProgressDelta);
    const pool = plausible.length ? plausible : candidates;
    // At a self-intersection, prefer the part of the route near the previous progress.
    const nearestOffset = Math.min(...pool.map(c => c.offsetMeters));
    const near = pool.filter(c => c.offsetMeters <= nearestOffset + 0.01);
    near.sort((a, b) => previousDistance === null ? a.distanceTravelledMeters - b.distanceTravelledMeters
      : Math.abs(a.distanceTravelledMeters - previousDistance) - Math.abs(b.distanceTravelledMeters - previousDistance));
    const best = near[0];
    const travelled = Math.max(0, Math.min(route.distanceMeters, best.distanceTravelledMeters));
    return {
      snapped: best.location, distanceFromRouteMeters: best.offsetMeters,
      distanceTravelledMeters: travelled,
      remainingDistanceMeters: Math.max(0, route.distanceMeters - travelled),
      remainingDurationSeconds: Math.max(0, remainingSeconds(travelled)),
      fractionComplete: route.distanceMeters ? travelled / route.distanceMeters : 1,
      discontinuous: !plausible.length,
    };
  };
}
