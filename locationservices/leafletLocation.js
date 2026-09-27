import { createLocationTracker } from './locationTracker.js';
import { directionCone } from './direction.mjs';

const messages = {
  idle: 'Find your position on campus.',
  preparing: 'Preparing campus location…',
  locating: 'Waiting for your device’s location…',
  tracking: 'Following your live position',
  weak: 'Following your approximate position',
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

/** Connects location actions to the campus menu and adds layers to a Leaflet map. */
export function mountLocationServices({
  map,
  L,
  locateButton,
  stopButton,
  statusElement,
  geolocation = globalThis.navigator?.geolocation,
  secureContext = globalThis.isSecureContext,
  boundaryUrl = new URL('./campus-boundary.geojson', import.meta.url),
  fetchBoundary = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (!map || !L?.circle || !L?.circleMarker || !locateButton || !stopButton || !statusElement) {
    throw new TypeError('A Leaflet map, Leaflet library, and location menu elements are required.');
  }

  let state = { status: 'idle', tracking: false, fix: null, markerVisible: false };
  let tracker = null;
  let marker = null;
  let accuracyCircle = null;
  let cone = null, heading = null;
  let loading = false;
  let disposed = false;
  let request = 0;
  let boundaryAbort = null;
  let followedOnce = false;
  let followEnabled = true;
  const listeners = new Set();
  const snapshot = () => ({ ...state, fix: state.fix && { ...state.fix } });
  const locationLabel = locateButton.querySelector('strong');

  function handleLocate() {
    if (state.tracking || loading) stopTracking();
    else start();
  }

  function clearLayers() {
    if (marker && map.hasLayer(marker)) map.removeLayer(marker);
    if (accuracyCircle && map.hasLayer(accuracyCircle)) map.removeLayer(accuracyCircle);
    if (cone && map.hasLayer(cone)) map.removeLayer(cone);
  }

  function render() {
    if (disposed) return;
    const { status, tracking, fix, markerVisible } = state;
    statusElement.textContent = (messages[status] || messages.unavailable) +
      (markerVisible && fix ? ` (±${Math.ceil(fix.accuracy)} m)` : '');
    locateButton.dataset.state = status;
    const active = tracking || loading;
    locateButton.disabled = false;
    locateButton.setAttribute('aria-pressed', String(active));
    locateButton.setAttribute('aria-label', active ? 'Turn location off' : 'Turn location on');
    locationLabel.textContent = active ? 'Location on' :
      ['denied', 'timeout', 'unavailable', 'boundary-error'].includes(status)
        ? 'Retry location' : 'Locate me';
    stopButton.hidden = true;

    if ((!markerVisible && status !== 'outside') || !fix) {
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
    renderDirection();
    if (!map.hasLayer(marker)) marker.addTo(map);
  }

  function renderDirection() {
    const {fix,status}=state;
    if(heading===null||!fix||!['tracking','weak','outside'].includes(status)){
      if(cone&&map.hasLayer(cone))map.removeLayer(cone);
      return;
    }
    const points=directionCone(fix,heading);
    if(!cone)cone=L.polygon(points,{color:'#1676d2',weight:1,opacity:.3,
      fillColor:'#2785dd',fillOpacity:.24,interactive:false});
    else cone.setLatLngs(points);
    if(!map.hasLayer(cone))cone.addTo(map);
    marker?.bringToFront?.();
  }

  function setState(nextState) {
    if (disposed) return;
    state = nextState;
    render();
    if (followEnabled && nextState.markerVisible && nextState.fix) followFix(nextState.fix);
    for (const listener of listeners) listener(snapshot());
  }

  function followFix(fix) {
    const point = [fix.latitude, fix.longitude];
    if (!followedOnce) {
      const zoom = Math.min(map.getMaxZoom(), fix.accuracy > 100
        ? 16 : Math.max(map.getZoom(), 18));
      map.setView(point, zoom, { animate: true });
      followedOnce = true;
    } else {
      map.panTo(point, { animate: true, duration: 0.4 });
    }
  }

  function cancelLoad() {
    request += 1;
    boundaryAbort?.abort();
    boundaryAbort = null;
    loading = false;
  }

  async function start() {
    if (disposed || loading) return;
    if (tracker?.getState().tracking) return;
    followedOnce = false;
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
    followedOnce = false;
    if (tracker) tracker.stop();
    else setState({ status: 'stopped', tracking: false, fix: null, markerVisible: false });
  }

  function centerOnFix() {
    if (disposed) return;
    const fresh = tracker?.getState();
    if (!fresh?.markerVisible || !fresh.fix) return;
    const zoom = Math.min(map.getMaxZoom(), fresh.fix.accuracy > 100
      ? 16 : Math.max(map.getZoom(), 18));
    map.setView([fresh.fix.latitude, fresh.fix.longitude], zoom, { animate: true });
    followedOnce = true;
  }

  function pause() {
    if (disposed) return;
    const wasLoading = loading;
    cancelLoad();
    followedOnce = false;
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
    locateButton.removeEventListener('click', handleLocate);
    stopButton.removeEventListener('click', stopTracking);
    window.removeEventListener('pagehide', pause);
    document.removeEventListener('visibilitychange', pauseWhenHidden);
    map.off('unload', dispose);
    listeners.clear();
  }

  locateButton.addEventListener('click', handleLocate);
  stopButton.addEventListener('click', stopTracking);
  render();
  window.addEventListener('pagehide', pause);
  document.addEventListener('visibilitychange', pauseWhenHidden);
  map.on('unload', dispose);
  if (!secureContext) setState({ status: 'insecure', tracking: false, fix: null, markerVisible: false });
  else if (!geolocation) setState({ status: 'unsupported', tracking: false, fix: null, markerVisible: false });

  return { start, stop: stopTracking, center: centerOnFix, getState: snapshot,
    setHeading(value){if(disposed)return;heading=Number.isFinite(value)?value:null;renderDirection();},
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Supply a location listener.');
      if (disposed) return () => {};
      listeners.add(listener); return () => listeners.delete(listener);
    },
    setFollowing(value) { followEnabled = Boolean(value); followedOnce = false; },
    getFollowing: () => followEnabled,
    dispose };
}
