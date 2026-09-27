import { createLiveNavigation } from './liveNavigation.js';

/** Connects a journey to the application's single existing GPS owner. */
export function createClassNavigationSession({ navigation, locationServices, renderer, onState = () => {} }) {
  if (!locationServices?.subscribe || !locationServices?.setFollowing) throw new TypeError('A subscribable location service is required.');
  let destination = null, source = 'live', origin = '', mode = 'walk';
  let unsubscribe, ownsWatch = false, priorFollowing, revision = 0, active = false, disposed = false;
  let latest;
  function releaseFeed(restoreCamera = true) {
    unsubscribe?.(); unsubscribe = undefined;
    if (ownsWatch) { ownsWatch = false; locationServices.stop(); }
    if (restoreCamera && priorFollowing !== undefined) {
      locationServices.setFollowing(priorFollowing); priorFollowing = undefined;
    }
  }
  const live = createLiveNavigation({ navigation, renderer, onState(state) {
    latest = { ...state, source, mode, originLabel: source === 'manual' ? origin : 'Your location' };
    if (state.status === 'arrived') releaseFeed(false);
    onState(latest);
  } });
  function forward(state) {
    if (!active || source !== 'live') return;
    if (state.markerVisible && state.fix) live.updatePosition(state.fix);
    else live.invalidateLocation(state.status);
  }
  async function begin() {
    if (disposed || !destination) return;
    const token = ++revision;
    releaseFeed(); active = true;
    priorFollowing = locationServices.getFollowing(); locationServices.setFollowing(false);
    const pending = live.start({ to: destination, mode, ...(source === 'manual' ? { from: origin } : {}) });
    if (source === 'live') {
      const current = locationServices.getState();
      ownsWatch = !current.tracking && current.status !== 'preparing';
      unsubscribe = locationServices.subscribe(forward);
      forward(current);
      // start() is idempotent: no second browser watch when location is already on.
      Promise.resolve(locationServices.start()).catch(() => {
        if (token === revision && active) live.invalidateLocation('unavailable');
      });
    }
    try { await pending; }
    catch { /* The live controller already reports a visible error state. */ }
    return token === revision ? latest : null;
  }
  return {
    start({ to }) { destination = to; return begin(); },
    useManual(value) { source = 'manual'; origin = String(value).trim(); return begin(); },
    useLive() { source = 'live'; return begin(); },
    setMode(value) {
      if (!['walk', 'bike', 'scooter'].includes(value)) throw new TypeError('Unknown travel mode.');
      mode = value; return begin();
    },
    getState() { return latest ? structuredClone(latest) : null; },
    stop() { if (!disposed) { active = false; revision++; releaseFeed(); live.stop(); destination = null; } },
    dispose() { if (!disposed) { active = false; revision++; releaseFeed(); live.dispose(); disposed = true; } },
  };
}
