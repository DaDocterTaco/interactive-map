import { createLocationTracker } from './locationTracker.js';

const messages = {
  idle: 'Find your position on campus.',
  preparing: 'Preparing campus location…',
  locating: 'Waiting for your device’s location…',
  tracking: 'Live position',
  weak: 'Approximate position',
  outside: 'Your reported position is outside campus.',
  stale: 'Location is outdated. Waiting for a fresh position…',
  denied: 'Location blocked. Allow it in your browser, then retry.',
  timeout: 'Location timed out. Move into a clearer area and retry.',
  unavailable: 'Location unavailable. Check device settings and retry.',
  insecure: 'Location requires HTTPS or localhost.',
  unsupported: 'This browser does not provide device location.',
  'boundary-error': 'Campus map data could not load. Retry.',
  stopped: 'Location is off.',
  paused: 'Location paused. Tap Locate me to restart.',
};

/** Adds independent location controls and layers to an existing Leaflet map. */
export function mountLocationServices({
  map,
  L,
  geolocation = globalThis.navigator?.geolocation,
  secureContext = globalThis.isSecureContext,
  boundaryUrl = new URL('./campus-boundary.geojson', import.meta.url),
  fetchBoundary = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (!map || !L?.control || !L?.circle || !L?.circleMarker) {
    throw new TypeError('A Leaflet map and Leaflet library are required.');
  }

  let state = { status: 'idle', tracking: false, fix: null, markerVisible: false };
  let tracker = null;
  let marker = null;
  let accuracyCircle = null;
  let loading = false;
  let disposed = false;
  let request = 0;
  let boundaryAbort = null;
  const control = L.control({ position: 'topleft' });

  control.onAdd = () => {
    const root = document.createElement('div');
    root.className = 'ls-control';
    root.setAttribute('aria-label', 'Map location controls');

    const actions = document.createElement('div');
    actions.className = 'ls-actions';
    const locate = document.createElement('button');
    locate.type = 'button';
    locate.className = 'ls-button ls-locate';
    locate.textContent = '◎ Locate me';
    const center = document.createElement('button');
    center.type = 'button';
    center.className = 'ls-button';
    center.textContent = 'Find me';
    center.disabled = true;
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'ls-button';
    stop.textContent = 'Stop';
    stop.hidden = true;
    actions.append(locate, center, stop);

    const status = document.createElement('p');
    status.className = 'ls-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(actions, status);
    L.DomEvent.disableClickPropagation(root);
    L.DomEvent.disableScrollPropagation(root);

    locate.addEventListener('click', start);
    center.addEventListener('click', centerOnFix);
    stop.addEventListener('click', stopTracking);
    control.root = root;
    control.locate = locate;
    control.center = center;
    control.stop = stop;
    control.status = status;
    render();
    return root;
  };

  function clearLayers() {
    if (marker && map.hasLayer(marker)) map.removeLayer(marker);
    if (accuracyCircle && map.hasLayer(accuracyCircle)) map.removeLayer(accuracyCircle);
  }

  function render() {
    if (disposed || !control.root) return;
    const { status, tracking, fix, markerVisible } = state;
    control.status.textContent = (messages[status] || messages.unavailable) +
      (markerVisible && fix ? ` (±${Math.ceil(fix.accuracy)} m)` : '');
    control.root.dataset.state = status;
    control.locate.disabled = loading || (tracking && !['stale', 'outside'].includes(status));
    control.locate.textContent = ['stale', 'denied', 'timeout', 'unavailable',
      'boundary-error', 'outside'].includes(status) ? '↻ Retry location' : '◎ Locate me';
    control.center.disabled = !markerVisible;
    control.stop.hidden = !tracking && !loading;

    if (!markerVisible || !fix) {
      clearLayers();
      return;
    }
    const point = [fix.latitude, fix.longitude];
    if (!accuracyCircle) {
      accuracyCircle = L.circle(point, {
        radius: fix.accuracy,
        color: '#1465ad',
        weight: 1,
        opacity: 0.55,
        fillColor: '#2785dd',
        fillOpacity: 0.13,
        interactive: false,
      });
    } else {
      accuracyCircle.setLatLng(point);
      accuracyCircle.setRadius(fix.accuracy);
    }
    if (!marker) {
      marker = L.circleMarker(point, {
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: '#1676d2',
        fillOpacity: 1,
        interactive: false,
      });
    } else marker.setLatLng(point);
    if (!map.hasLayer(accuracyCircle)) accuracyCircle.addTo(map);
    if (!map.hasLayer(marker)) marker.addTo(map);
  }

  function setState(nextState) {
    if (disposed) return;
    state = nextState;
    render();
  }

  function cancelLoad() {
    request += 1;
    boundaryAbort?.abort();
    boundaryAbort = null;
    loading = false;
  }

  async function start() {
    if (disposed || loading) return;
    if (tracker?.getState().tracking) tracker.stop();
    if (tracker && tracker.getState().status !== 'boundary-error') {
      tracker.start();
      return;
    }
    // Check browser support before loading the static campus polygon.
    if (!secureContext || !geolocation) {
      tracker = createLocationTracker({ geolocation, secureContext, onChange: setState });
      tracker.start();
      return;
    }
    if (!fetchBoundary) {
      setState({ status: 'boundary-error', tracking: false, fix: null, markerVisible: false });
      return;
    }

    const token = ++request;
    const abort = new AbortController();
    boundaryAbort = abort;
    loading = true;
    setState({ status: 'preparing', tracking: false, fix: null, markerVisible: false });
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetchBoundary(boundaryUrl, { signal: abort.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Campus boundary unavailable');
      const boundary = await response.json();
      if (disposed || token !== request) return;
      loading = false;
      tracker = createLocationTracker({ geolocation, secureContext, boundary, onChange: setState });
      tracker.start();
    } catch {
      if (disposed || token !== request) return;
      loading = false;
      setState({ status: 'boundary-error', tracking: false, fix: null, markerVisible: false });
    } finally {
      clearTimeout(timer);
      if (boundaryAbort === abort) boundaryAbort = null;
    }
  }

  function stopTracking() {
    if (disposed) return;
    cancelLoad();
    if (tracker) tracker.stop();
    else setState({ status: 'stopped', tracking: false, fix: null, markerVisible: false });
  }

  function centerOnFix() {
    if (disposed) return;
    const fresh = tracker?.getState();
    if (!fresh?.markerVisible || !fresh.fix) return;
    const zoom = Math.min(map.getMaxZoom(), fresh.fix.accuracy > 100
      ? 16 : Math.max(map.getZoom(), 17));
    map.setView([fresh.fix.latitude, fresh.fix.longitude], zoom, { animate: true });
  }

  function pause() {
    if (disposed) return;
    const wasLoading = loading;
    cancelLoad();
    if (tracker?.getState().tracking) tracker.pause();
    else if (wasLoading) setState({ status: 'paused', tracking: false, fix: null, markerVisible: false });
  }

  function pauseWhenHidden() {
    if (document.hidden) pause();
  }

  function dispose() {
    if (disposed) return;
    cancelLoad();
    disposed = true;
    tracker?.destroy();
    clearLayers();
    control.remove();
    window.removeEventListener('pagehide', pause);
    document.removeEventListener('visibilitychange', pauseWhenHidden);
    map.off('unload', dispose);
  }

  control.addTo(map);
  window.addEventListener('pagehide', pause);
  document.addEventListener('visibilitychange', pauseWhenHidden);
  map.on('unload', dispose);
  if (!secureContext) setState({ status: 'insecure', tracking: false, fix: null, markerVisible: false });
  else if (!geolocation) setState({ status: 'unsupported', tracking: false, fix: null, markerVisible: false });

  return { start, stop: stopTracking, center: centerOnFix, getState: () => ({ ...state, fix: state.fix && { ...state.fix } }), dispose };
}
