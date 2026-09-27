import { createNavigation, createLeafletRenderer } from './index.js';
import { createClassNavigationSession } from './classNavigationSession.js';

const text = (tag, value, className) => {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  return node;
};
const locationMessages = {
  waiting: 'Getting your starting location…', idle: 'Getting your starting location…',
  preparing: 'Preparing your location…', locating: 'Waiting for your device location…',
  denied: 'Location is blocked. Allow it in your browser, or enter a starting point below.',
  outside: 'You appear to be outside campus. Choose a campus starting point below.',
  weak: 'GPS accuracy is too low for directions. Wait for a clearer signal or choose a starting point.',
  stale: 'Waiting for a fresh location. Your previous travel estimate is paused.',
  paused: 'Location paused while the page was hidden. Tap Use live location to resume.',
  stopped: 'Location is off. Tap Use live location or choose a starting point.',
  insecure: 'Live location needs HTTPS on your phone. You can still choose a starting point.',
  unavailable: 'Your location is unavailable. Try again or choose a starting point.',
  unsupported: 'This browser cannot provide a live location. Choose a starting point.',
  timeout: 'Location timed out. Try again or choose a starting point.',
  'boundary-error': 'Campus location data could not load. Retry or choose a starting point.',
  invalid: 'Waiting for a usable GPS reading. You can also choose a starting point.',
};
const routeErrors = {
  OUTSIDE_NETWORK: 'This starting point or building is too far from a mapped path. Try another nearby point.',
  NO_ROUTE: 'No connected path was found. Try another start or travel mode.',
  UNRESOLVED_LOCATION: 'We couldn’t find that place. Try a campus building name, code, coordinates, or Pick on map.',
  INVALID_LOCATION: 'Enter a campus building or valid latitude, longitude coordinates, or pick a point on the map.',
  AMBIGUOUS_LOCATION: 'That name matches more than one place. Use its building code or pick a point on the map.',
  DATA_UNAVAILABLE: 'The campus route data could not load. Check your connection and try again.',
};

/** Small class-popup integration. The route engine remains independent of ClassSearch. */
export function createClassNavigation({ map, L, locationServices, navigation = createNavigation({ cacheSize: 0 }) }) {
  let panel, root, status, estimate, originText, modeSelect, startingPoint, input, notes, noteList;
  let currentRoute = null, destination = null, frameRequest = null, picking = false, disposed = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const renderer = createLeafletRenderer({ map, L, fitBounds: false });
  function cancelPick() {
    map.off('click', pickOrigin); picking = false;
    map.getContainer().classList.remove('nav-picking-start');
  }
  function scheduleFrame() {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(() => { frameRequest = null; frame(); });
  }
  function frame() {
    if (!panel || panel.hidden || !destination || picking) return;
    const points = currentRoute ? currentRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]) : [];
    points.push([destination.latitude, destination.longitude]);
    const bounds = L.latLngBounds(points);
    const height = map.getSize().y;
    // Keep the entire path above the popup instead of hiding its destination.
    const bottom = Math.min(panel.getBoundingClientRect().height + 35, height * 0.57);
    map.invalidateSize({ pan: false });
    // A new route can arrive during the initial building move. Stop that flight
    // before reframing; overlapping Leaflet zoom transitions can drop fitBounds.
    map.stop();
    map.flyToBounds(bounds, { paddingTopLeft: [28, 86], paddingBottomRight: [28, bottom],
      maxZoom: 18, animate: !reduced.matches, duration: 0.55 });
  }
  const session = createClassNavigationSession({ navigation, locationServices,
    // Location services already draws the real position and accuracy circle.
    renderer: {
      show(route) { currentRoute = route; renderer.show(route); scheduleFrame(); },
      clear() { currentRoute = null; renderer.clear(); },
      dispose() { renderer.dispose(); },
    },
    onState(state) {
      if (!root || disposed) return;
      modeSelect.value = state.mode;
      estimate.hidden = true;
      root.dataset.status = state.status;
      originText.textContent = state.source === 'manual' ? `From ${state.originLabel} · chosen start` : 'From your live location';
      if (state.status === 'resolving' || state.status === 'routing') status.textContent = 'Finding a route to your class…';
      else if (state.status === 'rerouting') status.textContent = 'Updating your route from your new location…';
      else if (state.status === 'arrived') status.textContent = 'You’re near your class building. Follow signs to the room.';
      else if (state.status === 'error') {
        status.textContent = routeErrors[state.error?.code] || 'The route could not load. Try again.';
        startingPoint.open = true;
      } else if (state.offRoute) status.textContent = 'You’ve left the mapped path. Checking your new route…';
      else if (state.source === 'manual' && state.route) status.textContent = 'Route ready from your chosen starting point.';
      else if (state.status === 'navigating' && state.progress) status.textContent = 'Following your progress to the class building.';
      else status.textContent = locationMessages[state.locationStatus] || 'Waiting for a fresh location…';
      if (['denied', 'outside', 'weak', 'insecure', 'unavailable', 'unsupported', 'timeout', 'boundary-error'].includes(state.locationStatus)) startingPoint.open = true;
      const metric = state.source === 'manual' && state.route
        ? { seconds: state.route.durationSeconds, metres: state.route.distanceMeters }
        : state.progress && { seconds: state.progress.remainingDurationSeconds, metres: state.progress.remainingDistanceMeters };
      if (metric && ['navigating', 'waiting_location', 'arrived'].includes(state.status)) {
        const duration = metric.seconds < 60 ? 'Less than 1 min' : `About ${Math.ceil(metric.seconds / 60)} min`;
        const length = metric.metres < 1000 ? `${Math.round(metric.metres)} m` : `${(metric.metres / 1000).toFixed(1)} km`;
        estimate.textContent = state.status === 'arrived' ? 'Near destination' : `${duration} · ${length} ${state.source === 'live' ? 'remaining' : 'outdoor path'}`;
        estimate.hidden = false;
      }
      noteList.replaceChildren(...(state.route?.warnings || []).map(message => text('li', message)));
      notes.hidden = !state.route;
    },
  });
  function pickOrigin(event) {
    cancelPick(); input.value = `${event.latlng.lat.toFixed(7)}, ${event.latlng.lng.toFixed(7)}`;
    void session.useManual(input.value);
  }
  function mount(target) {
    if (root) return;
    panel = target; panel.classList.add('has-class-navigation');
    root = text('section', '', 'nav-class-route'); root.setAttribute('aria-label', 'Directions to class');
    const modeLabel = text('label', 'Travel by'); modeSelect = document.createElement('select');
    modeSelect.setAttribute('aria-label', 'Class travel mode');
    for (const [value, label] of [['walk', 'Walking'], ['bike', 'Bike'], ['scooter', 'Scooter']]) {
      const option = text('option', label); option.value = value; modeSelect.append(option);
    }
    modeLabel.append(modeSelect);
    estimate = text('p', '', 'nav-class-estimate'); estimate.hidden = true;
    status = text('p', '', 'nav-class-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    originText = text('p', '', 'nav-class-origin');
    const liveButton = text('button', 'Use live location', 'nav-class-live'); liveButton.type = 'button';
    startingPoint = document.createElement('details'); startingPoint.className = 'nav-class-start';
    const summary = text('summary', 'Choose a starting point');
    const form = document.createElement('form');
    const originLabel = text('label', 'Starting point'); input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'e.g. Graham Center, GC, or lat, lng'; input.required = true; input.maxLength = 180;
    input.setAttribute('aria-label', 'Navigation starting point'); originLabel.append(input);
    const manualButton = text('button', 'Use this start'); manualButton.type = 'submit';
    const pickButton = text('button', 'Pick on map'); pickButton.type = 'button';
    const actions = text('div', '', 'nav-class-start-actions'); actions.append(manualButton, pickButton);
    form.append(originLabel, actions); startingPoint.append(summary, form);
    notes = document.createElement('details'); notes.className = 'nav-class-notes'; notes.hidden = true;
    noteList = document.createElement('ul'); notes.append(text('summary', 'Route notes'), noteList);
    root.append(modeLabel, estimate, status, originText, liveButton, startingPoint, notes);
    panel.insertBefore(root, panel.querySelector('.class-directions'));
    form.addEventListener('submit', event => { event.preventDefault(); cancelPick(); void session.useManual(input.value); });
    liveButton.addEventListener('click', () => { cancelPick(); void session.useLive(); });
    modeSelect.addEventListener('change', () => { cancelPick(); void session.setMode(modeSelect.value); });
    pickButton.addEventListener('click', () => {
      cancelPick(); picking = true; map.getContainer().classList.add('nav-picking-start');
      status.textContent = 'Tap a campus path on the map to set your starting point.'; map.once('click', pickOrigin);
    });
    startingPoint.addEventListener('toggle', () => { if (!picking) scheduleFrame(); });
  }
  map.on('unload', dispose);
  function dispose() {
    if (disposed) return;
    disposed = true; cancelPick();
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    session.dispose(); root?.remove(); map.off('unload', dispose);
  }
  return {
    start({ location, panel: target }) {
      mount(target); cancelPick(); destination = location.building;
      panel.scrollTop = 0;
      scheduleFrame(); return session.start({ to: location.building });
    },
    frame,
    getState: session.getState,
    stop() {
      cancelPick(); destination = null;
      map.stop();
      if (frameRequest !== null) cancelAnimationFrame(frameRequest); frameRequest = null;
      session.stop();
    },
    dispose,
  };
}
