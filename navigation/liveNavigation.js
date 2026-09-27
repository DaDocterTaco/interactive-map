import { NavigationError, distance } from './geometry.js';
import { normalizeLocation } from './locations.js';
import { createRouteProgress } from './routeProgress.js';

const DEFAULTS = {
  staleAfterMs: 15000, maxAccuracyMeters: 40, offRouteMeters: 20,
  offRouteConfirmations: 2, rerouteIntervalMs: 5000,
  arrivalMeters: 15, arrivalAccuracyMeters: 15, arrivalConfirmations: 2,
  maxProgressSpeedMps: 15,
};

/** Headless live journey. No GPS watch, map, UI, or network is started on import. */
export function createLiveNavigation({ navigation, renderer, onState = () => {}, settings = {},
  now = Date.now, setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis) } = {}) {
  if (typeof navigation?.getRoute !== 'function') throw new TypeError('Supply a navigation service.');
  const config = { ...DEFAULTS, ...settings };
  if (Object.keys(settings).some(k => !(k in DEFAULTS)) || Object.values(config).some(v => !Number.isFinite(v) || v <= 0) ||
      !Number.isInteger(config.offRouteConfirmations) || !Number.isInteger(config.arrivalConfirmations)) {
    throw new TypeError('Live settings must be positive numbers; confirmation counts must be integers.');
  }
  const listeners = new Set();
  let state = { status: 'idle', active: false, locationStatus: 'waiting', destination: null,
    position: null, route: null, progress: null, offRoute: false, error: null, rerouteCount: 0 };
  let session = 0, routeVersion = 0, resolverAbort, routeAbort;
  let staleTimer = null, rerouteTimer = null, disposed = false;
  let requestOptions = {}, lastTimestamp = -Infinity, lastAttemptAt = -Infinity;
  let measure = null, previousDistance = null, previousProgressTime = null;
  let offCount = 0, arrivalCount = 0, routeTask = Promise.resolve();
  const snapshot = () => structuredClone(state);
  function emit(patch) {
    state = { ...state, ...patch };
    const value = snapshot();
    onState(value);
    for (const listener of listeners) listener(snapshot());
  }
  function clearTimers() {
    if (staleTimer !== null) clearTimer(staleTimer);
    if (rerouteTimer !== null) clearTimer(rerouteTimer);
    staleTimer = rerouteTimer = null;
  }
  function cancelRoute() { routeVersion++; routeAbort?.abort(); routeAbort = undefined; }
  function fresh() {
    return state.locationStatus === 'good' && state.position && now() - state.position.timestamp < config.staleAfterMs;
  }
  function invalidateLocation(reason = 'unavailable') {
    if (disposed || !state.active) return;
    clearTimers(); cancelRoute(); offCount = arrivalCount = 0;
    previousDistance = previousProgressTime = null;
    renderer?.clearPosition?.();
    emit({ status: state.destination ? 'waiting_location' : state.status, locationStatus: reason,
      progress: null, offRoute: false });
  }
  function scheduleReroute() {
    if (routeAbort || rerouteTimer !== null || !fresh() || !state.active) return;
    const delay = Math.max(0, config.rerouteIntervalMs - (now() - lastAttemptAt));
    if (!delay) { void requestRoute(state.position, true); return; }
    rerouteTimer = setTimer(() => {
      rerouteTimer = null;
      if (state.active && fresh() && offCount >= config.offRouteConfirmations) void requestRoute(state.position, true);
    }, delay);
  }
  function applyProgress(fix, countConfirmation) {
    if (!measure || !state.active) return;
    const elapsed = previousProgressTime === null ? Infinity : Math.max(0, (fix.timestamp - previousProgressTime) / 1000);
    const progress = measure(fix, { previousDistance,
      maxProgressDelta: Math.max(30, elapsed * config.maxProgressSpeedMps + 2 * fix.accuracy) });
    const offRoute = progress.discontinuous || progress.distanceFromRouteMeters > Math.max(config.offRouteMeters, fix.accuracy * 1.5);
    const nearDestination = !progress.discontinuous && distance(fix, state.destination) <= config.arrivalMeters &&
      progress.remainingDistanceMeters <= config.arrivalMeters && fix.accuracy <= config.arrivalAccuracyMeters;
    if (countConfirmation) {
      offCount = offRoute ? offCount + 1 : 0;
      arrivalCount = nearDestination ? arrivalCount + 1 : 0;
    }
    renderer?.updatePosition?.(fix);
    if (arrivalCount >= config.arrivalConfirmations) {
      clearTimers(); cancelRoute();
      emit({ status: 'arrived', active: false, offRoute: false, progress, error: null });
      return;
    }
    if (!offRoute) {
      previousDistance = progress.distanceTravelledMeters; previousProgressTime = fix.timestamp;
      if (rerouteTimer !== null) { clearTimer(rerouteTimer); rerouteTimer = null; }
    }
    emit({ status: routeAbort ? 'rerouting' : 'navigating', offRoute,
      // Avoid displaying an ETA from a route the user has left.
      progress: offRoute ? null : progress, error: null });
    if (offRoute && offCount >= config.offRouteConfirmations) scheduleReroute();
  }
  function requestRoute(origin, isReroute) {
    if (!state.active || !state.destination || routeAbort) return routeTask;
    const ownSession = session, ownVersion = ++routeVersion;
    const abort = new AbortController(); routeAbort = abort;
    lastAttemptAt = now();
    emit({ status: isReroute ? 'rerouting' : 'routing', error: null, progress: null });
    routeTask = (async () => {
      try {
        const route = await navigation.getRoute({ ...requestOptions, from: origin, to: state.destination }, { signal: abort.signal });
        if (disposed || session !== ownSession || routeVersion !== ownVersion || !state.active) return;
        const prepared = createRouteProgress(route);
        routeAbort = undefined; measure = prepared;
        previousDistance = previousProgressTime = null; offCount = arrivalCount = 0;
        renderer?.show(route);
        emit({ status: fresh() ? 'navigating' : 'waiting_location', route, offRoute: false,
          rerouteCount: state.rerouteCount + (isReroute ? 1 : 0), error: null });
        // A route response is not another GPS confirmation. Use the newest fix.
        if (fresh()) applyProgress(state.position, false);
      } catch (error) {
        if (disposed || session !== ownSession || routeVersion !== ownVersion || !state.active) return;
        routeAbort = undefined; measure = null; renderer?.clear();
        emit({ status: 'error', route: null, progress: null,
          error: { code: error.code || 'ROUTING_FAILED', message: error.message } });
      }
    })();
    return routeTask;
  }
  function updatePosition(input) {
    if (disposed || !state.active) return false;
    let fix;
    try {
      const value = input?.fix ?? input?.position ?? input;
      const coordinates = value?.coords ?? value;
      fix = { ...normalizeLocation(value), accuracy: coordinates?.accuracy, timestamp: value?.timestamp };
      if (!Number.isFinite(fix.accuracy) || fix.accuracy < 0 || !Number.isFinite(fix.timestamp) || fix.timestamp > now() + 1000) {
        throw new Error('Live fixes need accuracy and a timestamp.');
      }
    } catch { invalidateLocation('invalid'); return false; }
    if (fix.timestamp <= lastTimestamp) return false;
    lastTimestamp = fix.timestamp;
    if (now() - fix.timestamp >= config.staleAfterMs) { invalidateLocation('stale'); return false; }
    if (staleTimer !== null) clearTimer(staleTimer);
    state = { ...state, position: fix };
    if (fix.accuracy > config.maxAccuracyMeters) {
      invalidateLocation('weak');
      staleTimer = setTimer(() => { staleTimer = null; invalidateLocation('stale'); }, config.staleAfterMs - (now() - fix.timestamp));
      return false;
    }
    state = { ...state, locationStatus: 'good' };
    staleTimer = setTimer(() => { staleTimer = null; invalidateLocation('stale'); }, config.staleAfterMs - (now() - fix.timestamp));
    renderer?.updatePosition?.(fix);
    if (!state.destination) { emit({}); return true; }
    if (measure) applyProgress(fix, true);
    else if (!routeAbort && now() - lastAttemptAt >= config.rerouteIntervalMs) void requestRoute(fix, false);
    else if (!routeAbort && rerouteTimer === null) {
      rerouteTimer = setTimer(() => {
        rerouteTimer = null;
        if (state.active && fresh()) void requestRoute(state.position, false);
      }, Math.max(1, config.rerouteIntervalMs - (now() - lastAttemptAt)));
    }
    return true;
  }
  function stop() {
    session++; resolverAbort?.abort(); resolverAbort = undefined;
    cancelRoute(); clearTimers(); measure = null;
    renderer?.clear();
    emit({ status: 'stopped', active: false, locationStatus: 'stopped', destination: null,
      position: null, route: null, progress: null, offRoute: false, error: null });
  }
  return {
    async start({ to, from, ...options } = {}) {
      if (disposed) throw new NavigationError('DISPOSED', 'Live navigation has been disposed.');
      session++; resolverAbort?.abort(); cancelRoute(); clearTimers(); renderer?.clear();
      const ownSession = session, abort = new AbortController(); resolverAbort = abort;
      requestOptions = structuredClone(options);
      routeTask = Promise.resolve();
      measure = null; previousDistance = previousProgressTime = null;
      lastTimestamp = lastAttemptAt = -Infinity; offCount = arrivalCount = 0;
      emit({ status: 'resolving', active: true, locationStatus: 'waiting', destination: null,
        position: null, route: null, progress: null, offRoute: false, error: null, rerouteCount: 0 });
      try {
        const resolve = navigation.resolveLocation?.bind(navigation) ?? (async input => normalizeLocation(input));
        const destination = await resolve(to, { signal: abort.signal });
        if (disposed || session !== ownSession) return snapshot();
        emit({ status: 'waiting_location', destination });
        if (fresh()) await requestRoute(state.position, false);
        else if (from !== undefined) {
          const source = from?.coords ?? from?.fix ?? from;
          if (source?.accuracy !== undefined || from?.timestamp !== undefined) {
            updatePosition(from); await routeTask;
          } else {
            const origin = await resolve(from, { signal: abort.signal });
            if (session === ownSession && !disposed && !measure) await requestRoute(fresh() ? state.position : origin, false);
          }
        }
        if (session === ownSession) resolverAbort = undefined;
        return snapshot();
      } catch (error) {
        if (disposed || session !== ownSession) return snapshot();
        resolverAbort = undefined;
        emit({ status: 'error', active: false, error: { code: error.code || 'INVALID_LOCATION', message: error.message } });
        throw error;
      }
    },
    updatePosition,
    invalidateLocation,
    /** Replan immediately for a caller-supplied closure or changed travel options. */
    async refresh(options = {}) {
      if (disposed) throw new NavigationError('DISPOSED', 'Live navigation has been disposed.');
      if (!state.active || !fresh() || !state.destination) return snapshot();
      const { from, to, ...changes } = options;
      if (from !== undefined || to !== undefined) throw new NavigationError('INVALID_OPTIONS', 'Use start() to change the journey endpoints.');
      requestOptions = { ...requestOptions, ...structuredClone(changes) };
      cancelRoute(); if (rerouteTimer !== null) clearTimer(rerouteTimer); rerouteTimer = null;
      await requestRoute(state.position, Boolean(state.route));
      return snapshot();
    },
    getState: snapshot,
    subscribe(listener) {
      if (disposed) throw new NavigationError('DISPOSED', 'Live navigation has been disposed.');
      if (typeof listener !== 'function') throw new TypeError('Supply a state listener.');
      listeners.add(listener); return () => listeners.delete(listener);
    },
    stop() { if (!disposed) stop(); },
    dispose() { if (!disposed) { stop(); disposed = true; listeners.clear(); renderer?.dispose(); } },
  };
}
