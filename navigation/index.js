import { NavigationError, point, abortIfNeeded } from './geometry.js';
import { createCampusLocationResolver } from './locations.js';
export { NavigationError } from './geometry.js';
export { createGraphProvider, DEFAULT_SPEEDS } from './graphProvider.js?v=mode-speeds-1';
export { createLeafletRenderer } from './leafletRenderer.js';
export { normalizeLocation, createLocationResolver, createCampusLocationResolver } from './locations.js';
export { createLiveNavigation } from './liveNavigation.js';
export { createBrowserLocationSource } from './browserLocationSource.js';

/** Data is fetched once, on first route, and kept in memory for this instance. */
export function createCampusProvider({ graphUrl = new URL('./data/campus-graph.json', import.meta.url), fetchImpl = globalThis.fetch } = {}) {
  let loaded;
  return {
    async getRoute(request, { signal } = {}) {
      abortIfNeeded(signal);
      if (!loaded) {
        loaded = Promise.resolve().then(async () => {
          try {
            const response = await fetchImpl(graphUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const [{ createGraphProvider }, graph] = await Promise.all([
              import('./graphProvider.js?v=mode-speeds-1'), response.json(),
            ]);
            return createGraphProvider(graph);
          } catch (error) {
            loaded = undefined;
            throw new NavigationError('DATA_UNAVAILABLE', `Could not load navigation data: ${error.message}`);
          }
        });
      }
      // A caller cancelling must not cancel the shared graph load for other callers.
      const provider = await loaded;
      abortIfNeeded(signal);
      return provider.getRoute(request, { signal });
    },
  };
}

function withCancellation(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new NavigationError('ABORTED', 'Route request cancelled.'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

/** One instance can serve many independent sections without shared UI state. */
export function createNavigation({ provider = createCampusProvider(), cacheSize = 32,
  resolveLocation = createCampusLocationResolver() } = {}) {
  if (typeof provider?.getRoute !== 'function' || typeof resolveLocation !== 'function' || !Number.isInteger(cacheSize) || cacheSize < 0 || cacheSize > 500) {
    throw new TypeError('Supply a getRoute provider and a cacheSize from 0 to 500.');
  }
  const cache = new Map();
  let revision = 0;
  async function resolve(input, { signal } = {}) {
    abortIfNeeded(signal);
    const result = await withCancellation(Promise.resolve().then(() => resolveLocation(input, { signal })), signal);
    abortIfNeeded(signal);
    return point(result);
  }
  return {
    resolveLocation: resolve,
    async getRoute(request, { signal } = {}) {
      abortIfNeeded(signal);
      if (!request) throw new NavigationError('INVALID_LOCATION', 'Supply from and to locations.');
      // Normalize DOM-backed positions/markers before cloning; their methods are not cloneable.
      const { from, to, ...options } = request;
      const copiedOptions = structuredClone(options);
      const [origin, destination] = await Promise.all([resolve(from, { signal }), resolve(to, { signal })]);
      const input = { ...copiedOptions, from: origin, to: destination, mode: options.mode ?? 'walk' };
      const key = JSON.stringify(input);
      if (cache.has(key)) {
        const route = cache.get(key); cache.delete(key); cache.set(key, route);
        return structuredClone(route);
      }
      const startedRevision = revision;
      const route = await withCancellation(Promise.resolve().then(() => provider.getRoute(input, { signal })), signal);
      abortIfNeeded(signal);
      if (cacheSize && startedRevision === revision) {
        cache.set(key, structuredClone(route));
        while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      }
      return structuredClone(route);
    },
    clearCache() { revision++; cache.clear(); },
  };
}

/** Optional controller: latest request wins for one panel/map's route display. */
export function createRouteController({ navigation, renderer, onState = () => {} }) {
  let pending, generation = 0, disposed = false;
  const clear = () => {
    generation++; pending?.abort(); pending = undefined; renderer?.clear();
  };
  return {
    async route(request) {
      if (disposed) throw new NavigationError('DISPOSED', 'This route controller has been disposed.');
      clear();
      const ownGeneration = generation;
      pending = new AbortController();
      onState({ status: 'loading' });
      try {
        const result = await navigation.getRoute(request, { signal: pending.signal });
        if (disposed || generation !== ownGeneration) return null;
        pending = undefined; renderer?.show(result); onState({ status: 'ready', route: result });
        return result;
      } catch (error) {
        if (disposed || generation !== ownGeneration) return null;
        pending = undefined; onState({ status: 'error', error });
        throw error;
      }
    },
    clear() { if (!disposed) { clear(); onState({ status: 'idle' }); } },
    dispose() { if (!disposed) { clear(); disposed = true; renderer?.dispose(); } },
  };
}
