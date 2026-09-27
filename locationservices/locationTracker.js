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
      if (timestamp < lastTimestamp) return;
      lastTimestamp = timestamp;
      clearStale();
      const age = Math.max(0, now() - timestamp);
      if (age >= staleAfterMs) {
        emit('stale');
        return;
      }
      const fix = { latitude, longitude, accuracy, timestamp };
      const onCampus = pointInPolygons(latitude, longitude, polygons);
      emit(onCampus ? (accuracy > weakAccuracyMeters ? 'weak' : 'tracking') : 'outside', fix);
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
