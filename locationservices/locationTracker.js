/** Browser geolocation state, independent of Leaflet and the page layout. */

function polygonsFromGeoJSON(boundary) {
  const geometry = boundary?.type === 'Feature' ? boundary.geometry : boundary;
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length || polygons.some(polygon =>
    !Array.isArray(polygon) || !polygon.length || polygon.some(ring =>
      !Array.isArray(ring) || ring.length < 4 || ring.some(point =>
        !Array.isArray(point) || point.length < 2 ||
        !Number.isFinite(point[0]) || !Number.isFinite(point[1])) ||
      ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1]))) {
    throw new TypeError('A closed GeoJSON campus Polygon or MultiPolygon is required.');
  }
  return polygons;
}

function ringContains(longitude, latitude, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const cross = (longitude - ax) * dy - (latitude - ay) * dx;
    if (length && Math.abs(cross) <= 1e-10 * length &&
        longitude >= Math.min(ax, bx) - 1e-10 && longitude <= Math.max(ax, bx) + 1e-10 &&
        latitude >= Math.min(ay, by) - 1e-10 && latitude <= Math.max(ay, by) + 1e-10) return 0;
    if ((ay > latitude) !== (by > latitude) &&
        longitude < dx * (latitude - ay) / dy + ax) inside = !inside;
  }
  return inside ? 1 : -1;
}

function pointInPolygons(latitude, longitude, polygons) {
  return polygons.some(([outer, ...holes]) => {
    const shell = ringContains(longitude, latitude, outer);
    if (shell < 0) return false;
    if (shell === 0) return true;
    for (const hole of holes) {
      const result = ringContains(longitude, latitude, hole);
      if (result === 0) return true;
      if (result === 1) return false;
    }
    return true;
  });
}

export function isOnCampus(latitude, longitude, boundary) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return pointInPolygons(latitude, longitude, polygonsFromGeoJSON(boundary));
}

function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) *
    Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Keep uncertainty separate from the displayed position; never learn from rejected fixes. */
function createPositionFilter(staleAfterMs) {
  let accepted = null, displayed = null, candidate = null;
  return raw => {
    if (!accepted || raw.timestamp - accepted.timestamp >= staleAfterMs) {
      accepted = displayed = raw;
      candidate = null;
      return raw;
    }
    const elapsed = (raw.timestamp - accepted.timestamp) / 1000;
    // A sudden loss of accuracy must not drag a previously good fix across campus.
    if (raw.accuracy > Math.max(50, accepted.accuracy * 3)) {
      candidate = null;
      return null;
    }
    const distance = distanceMeters(displayed, raw);
    const jumpLimit = Math.max(25, Math.min(25, accepted.accuracy) +
      Math.min(25, raw.accuracy), 7 * Math.min(elapsed, 5));
    if (distance > jumpLimit) {
      const clusterRadius = Math.max(12, Math.min(20, raw.accuracy) +
        Math.min(20, candidate?.anchor.accuracy ?? raw.accuracy));
      if (!candidate || raw.timestamp - candidate.anchor.timestamp > 8000 ||
          distanceMeters(candidate.anchor, raw) > clusterRadius) {
        candidate = { anchor: raw, count: 1 };
      } else {
        candidate.count += 1;
      }
      // Confirm a relocation with independent readings spanning at least two seconds.
      if (candidate.count < 3 || raw.timestamp - candidate.anchor.timestamp < 2000) return null;
      accepted = displayed = raw;
      candidate = null;
      return raw;
    }
    candidate = null;
    const deadband = Math.max(2, Math.min(8, raw.accuracy * 0.35));
    const weight = distance <= deadband ? 0 : Math.max(0.1, Math.min(0.85,
      (1 - Math.exp(-elapsed / 1.5)) * Math.min(1, accepted.accuracy / Math.max(1, raw.accuracy))));
    const fix = {
      ...raw,
      latitude: displayed.latitude + (raw.latitude - displayed.latitude) * weight,
      longitude: displayed.longitude + (raw.longitude - displayed.longitude) * weight,
    };
    // Include the smoothing offset instead of claiming more precision than the device.
    fix.accuracy = raw.accuracy + distanceMeters(fix, raw);
    accepted = raw;
    displayed = fix;
    return fix;
  };
}

export function createLocationTracker({
  geolocation,
  secureContext = true,
  boundary,
  onChange = () => {},
  now = Date.now,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
  staleAfterMs = 30000,
  weakAccuracyMeters = 100,
} = {}) {
  let polygons;
  try { polygons = polygonsFromGeoJSON(boundary); } catch { polygons = null; }
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0 ||
      !Number.isFinite(weakAccuracyMeters) || weakAccuracyMeters <= 0) {
    throw new RangeError('Location thresholds must be positive numbers.');
  }

  let state = { status: 'idle', tracking: false, fix: null, markerVisible: false };
  let watchId = null;
  let staleTimer = null;
  let generation = 0;
  let lastTimestamp = -Infinity;
  let disposed = false;

  const snapshot = () => ({ ...state, fix: state.fix ? { ...state.fix } : null });
  function emit(status, fix = null) {
    state = {
      status,
      tracking: state.tracking,
      fix,
      markerVisible: (status === 'tracking' || status === 'weak') && fix !== null,
    };
    onChange(snapshot());
    return snapshot();
  }
  function clearStale() {
    if (staleTimer !== null) clearTimer(staleTimer);
    staleTimer = null;
  }
  function clearWatch() {
    generation += 1;
    state.tracking = false;
    clearStale();
    if (watchId !== null) {
      const id = watchId;
      watchId = null;
      try { geolocation.clearWatch(id); } catch { /* Page teardown can interrupt cleanup. */ }
    }
  }
  function finish(status) {
    clearWatch();
    return emit(status);
  }

  function start() {
    if (disposed || state.tracking) return snapshot();
    if (!secureContext) return finish('insecure');
    if (!geolocation || typeof geolocation.watchPosition !== 'function' ||
        typeof geolocation.clearWatch !== 'function') return finish('unsupported');
    if (!polygons) return finish('boundary-error');

    const token = ++generation;
    state.tracking = true;
    lastTimestamp = -Infinity;
    const filterPosition = createPositionFilter(staleAfterMs);
    emit('locating');
    if (!state.tracking || token !== generation) return snapshot();

    function receive(position) {
      if (!state.tracking || token !== generation || disposed) return;
      const { latitude, longitude, accuracy } = position?.coords || {};
      const timestamp = position?.timestamp;
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
          !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
          !Number.isFinite(accuracy) || accuracy < 0 ||
          !Number.isFinite(timestamp) || timestamp > now() + 1000) {
        finish('unavailable');
        return;
      }
      if (timestamp <= lastTimestamp) return;
      lastTimestamp = timestamp;
      const age = Math.max(0, now() - timestamp);
      if (age >= staleAfterMs) {
        clearStale();
        emit('stale');
        return;
      }
      const fix = filterPosition({ latitude, longitude, accuracy, timestamp });
      // Leave the accepted fix's expiry intact when rejecting a spike.
      if (!fix) return;
      clearStale();
      const onCampus = pointInPolygons(fix.latitude, fix.longitude, polygons);
      emit(onCampus ? (fix.accuracy > weakAccuracyMeters ? 'weak' : 'tracking') : 'outside', fix);
      if (!state.tracking || token !== generation) return;
      staleTimer = setTimer(() => {
        staleTimer = null;
        if (state.tracking && token === generation && !disposed) emit('stale');
      }, staleAfterMs - age);
    }

    function fail(error) {
      if (!state.tracking || token !== generation || disposed) return;
      finish(error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable');
    }

    try {
      const id = geolocation.watchPosition(receive, fail, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      });
      if (state.tracking && token === generation) watchId = id;
      else geolocation.clearWatch(id);
    } catch (error) {
      if (state.tracking && token === generation) finish(error?.name === 'SecurityError' ? 'denied' : 'unavailable');
    }
    return snapshot();
  }

  return {
    start,
    stop() { return disposed ? snapshot() : finish('stopped'); },
    pause() { return disposed || !state.tracking ? snapshot() : finish('paused'); },
    destroy() {
      if (!disposed) {
        finish('stopped');
        disposed = true;
      }
    },
    getState: snapshot,
  };
}
