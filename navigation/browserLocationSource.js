/** Optional GPS owner. Prefer feeding the existing location service into updatePosition. */
export function createBrowserLocationSource({ live, geolocation = globalThis.navigator?.geolocation,
  secureContext = globalThis.isSecureContext, document = globalThis.document, window = globalThis.window } = {}) {
  if (typeof live?.updatePosition !== 'function' || typeof live?.subscribe !== 'function') throw new TypeError('Supply a live navigation controller.');
  let watchId = null, generation = 0, tracking = false, disposed = false, unsubscribe;
  function detach() {
    document?.removeEventListener('visibilitychange', visibilityChanged);
    window?.removeEventListener('pagehide', pageHidden);
    unsubscribe?.(); unsubscribe = undefined;
  }
  function release() {
    generation++; tracking = false;
    if (watchId !== null) {
      const id = watchId; watchId = null;
      try { geolocation.clearWatch(id); } catch { /* Browser teardown. */ }
    }
    detach();
  }
  function stop(reason = 'stopped') {
    const ownedWatch = tracking;
    release();
    if (ownedWatch) live.invalidateLocation(reason);
  }
  function visibilityChanged() { if (document?.hidden) stop('paused'); }
  function pageHidden() { stop('paused'); }
  return {
    start() {
      if (disposed || tracking) return tracking;
      if (!live.getState().active) return false;
      if (!secureContext) { live.invalidateLocation('insecure'); return false; }
      if (!geolocation?.watchPosition || !geolocation?.clearWatch) { live.invalidateLocation('unsupported'); return false; }
      if (document?.hidden) { live.invalidateLocation('paused'); return false; }
      tracking = true; const ownGeneration = ++generation;
      document?.addEventListener('visibilitychange', visibilityChanged);
      window?.addEventListener('pagehide', pageHidden);
      unsubscribe = live.subscribe(state => { if (!state.active) release(); });
      try {
        const id = geolocation.watchPosition(position => {
          if (tracking && ownGeneration === generation) live.updatePosition(position);
        }, error => {
          if (!tracking || ownGeneration !== generation) return;
          const reason = error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable';
          // Denial ends the watch. Temporary failures can recover on a later fresh fix.
          if (reason === 'denied') stop(reason); else live.invalidateLocation(reason);
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
        if (tracking && ownGeneration === generation) watchId = id;
        else geolocation.clearWatch(id);
      } catch (error) { stop(error?.name === 'SecurityError' ? 'denied' : 'unavailable'); }
      return tracking;
    },
    stop() { if (!disposed) stop(); },
    getState() { return { tracking, disposed }; },
    dispose() { if (!disposed) { stop(); disposed = true; } },
  };
}
