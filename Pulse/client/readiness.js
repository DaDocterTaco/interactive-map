import { usableSpot } from '../shared/policy.js';

export function campusReadiness(snapshot) {
  // A missing cached document is not proof that the campus has not been set up.
  if (!snapshot || snapshot.fromCache) return 'loading';
  return snapshot.exists && snapshot.data?.enabled === true ? 'ready' : 'unavailable';
}

export function canStartPulse(campus, spotsReady, spots) {
  return campusReadiness(campus) === 'ready' && spotsReady && spots.some(usableSpot);
}

export function activePulseState(state) {
  return ['waiting', 'proposed', 'confirmed'].includes(state?.status);
}

export function needsPulseSync(campus, stateReady, state) {
  // Opening Pulse, signing in, and returning to the tab are all read-only while idle.
  // Existing sessions must still expire/cancel if the campus disables new matching.
  return !!campus && !campus.fromCache && campus.exists && stateReady && activePulseState(state);
}

export function connectionMessage({ online, stale, active }) {
  if (!online) return active ? 'You’re offline. Your saved plan may be out of date. Reconnect to respond or check in.' : 'You’re offline. Reconnect to check Pulse availability.';
  return stale && active ? 'Reconnecting… This plan may be out of date.' : '';
}

export function isConnectionFailure(error) {
  return ['functions/unavailable', 'functions/deadline-exceeded', 'unavailable'].includes(error?.code);
}
