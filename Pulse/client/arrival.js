import { POLICY, distanceMeters } from '../shared/policy.js';

export function locationFix(position) {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude,
    accuracy: position.coords.accuracy, capturedAt: position.timestamp };
}

export function currentPosition(geolocation = navigator.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation) return reject(Error('Live location is unavailable in this browser. Open Pulse in a browser with location access.'));
    geolocation.getCurrentPosition(p => resolve(locationFix(p)), error => reject(Error(error.code === 1
      ? 'Allow location access in your browser settings, then tap an activity again.'
      : 'Could not get your live location. Check that location services are on and try again outdoors.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  });
}

// Fixes live only in memory. The backend validates them again and stores only arrival.
export function startArrival({ spot, confirmedAt, onArrive, onStatus,
  geolocation = navigator.geolocation, now = Date.now }) {
  let watchId = null, stopped = false, submitting = false, samples = [];
  const stop = () => { stopped = true; samples = []; if (watchId !== null) geolocation?.clearWatch(watchId); };
  if (!geolocation) { onStatus('Location is unavailable. Use “I’m here” instead.'); return stop; }
  onStatus('Checking your location while this page is visible…');
  watchId = geolocation.watchPosition(async position => {
    if (stopped || submitting) return;
    const fix = locationFix(position), time = now();
    samples = samples.filter(f => time - f.capturedAt <= POLICY.autoMaxFixAgeMs);
    if (fix.capturedAt < confirmedAt || fix.capturedAt > time + 5_000 || time - fix.capturedAt > POLICY.autoMaxFixAgeMs
        || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > POLICY.autoMaxAccuracyMeters) {
      samples = []; onStatus('Location is approximate. Try outdoors, or tap “I’m here”.'); return;
    }
    if (distanceMeters(fix, spot) + fix.accuracy > POLICY.autoRadiusMeters) {
      samples = []; onStatus('Auto arrival is on. Move close to the meeting point.'); return;
    }
    const first = samples.find(f => fix.capturedAt - f.capturedAt >= POLICY.autoDwellMs);
    if (!samples.some(f => f.capturedAt === fix.capturedAt)) samples.push(fix);
    onStatus('You’re nearby. Stay here for a fresh arrival reading…');
    if (!first) return;
    submitting = true;
    try { await onArrive([first, fix]); stop(); onStatus('You’re checked in. Location checking has stopped.'); }
    catch { samples = []; onStatus('Arrival was not confirmed. Trying again; you can also tap “I’m here”.'); }
    finally { submitting = false; }
  }, () => { stop(); onStatus('Location could not be read. Turn auto arrival off and on to retry, or tap “I’m here”.'); },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  return stop;
}
