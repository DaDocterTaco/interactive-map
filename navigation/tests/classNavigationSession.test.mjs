import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigation, createGraphProvider, createLocationResolver } from '../index.js';
import { createClassNavigationSession } from '../classNavigationSession.js';

const from = { lat: 25, lng: -80 }, to = { lat: 25, lng: -79.998 };
const graph = { schemaVersion: 1, nodes: [[25, -80], [25, -79.998]], links: [[0, 1, 0]],
  profiles: [{ kind: 'footway', access: { walk: 'travel', bike: 'travel', scooter: 'travel' } }] };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ preexisting = false } = {}) {
  let state = { status: preexisting ? 'tracking' : 'idle', tracking: preexisting, markerVisible: false, fix: null };
  let following = true, watches = preexisting ? 1 : 0, stops = 0, timestamp = Date.now();
  const listeners = new Set(), results = [];
  const source = {
    getState: () => state, getFollowing: () => following, setFollowing: value => { following = value; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() { if (!state.tracking) { watches++; state = { ...state, tracking: true, status: 'locating' }; } },
    stop() { stops++; state = { status: 'stopped', tracking: false, markerVisible: false, fix: null }; for (const l of listeners) l(state); },
  };
  const navigation = createNavigation({ provider: createGraphProvider(graph), cacheSize: 0,
    resolveLocation: createLocationResolver({ places: [{ id: 'START', name: 'Test start', ...from }] }) });
  const session = createClassNavigationSession({ navigation, locationServices: source, onState: value => results.push(value) });
  return { session, source, results, listeners,
    emit(status = 'tracking', p = from) {
      state = { tracking: true, status, markerVisible: status === 'tracking' || status === 'weak',
        fix: { latitude: p.lat, longitude: p.lng, accuracy: status === 'weak' ? 200 : 5, timestamp: ++timestamp } };
      for (const listener of listeners) listener(state);
    },
    get watches() { return watches; }, get stops() { return stops; }, get following() { return following; },
  };
}
test('class journey uses shared GPS, reports route/ETA, and restores camera ownership on dismiss', async () => {
  const f = fixture(); await f.session.start({ to });
  assert.equal(f.watches, 1); assert.equal(f.following, false);
  f.emit(); await flush();
  assert.equal(f.session.getState().status, 'navigating'); assert.ok(f.session.getState().progress.remainingDurationSeconds > 100);
  f.emit('tracking', { lat: 25, lng: -79.9999 }); await flush();
  assert.ok(f.session.getState().progress.fractionComplete > 0);
  f.session.stop(); assert.equal(f.stops, 1); assert.equal(f.following, true); assert.equal(f.listeners.size, 0);
  assert.equal(f.session.getState().route, null); f.session.dispose();
});
test('a preexisting GPS watch survives closing class directions', async () => {
  const f = fixture({ preexisting: true }); await f.session.start({ to }); f.emit(); await flush(); f.session.stop();
  assert.equal(f.watches, 1); assert.equal(f.stops, 0); assert.equal(f.source.getState().tracking, true); f.session.dispose();
});
test('manual start works when GPS is denied and does not leave a class-owned watch running', async () => {
  const f = fixture(); await f.session.start({ to }); f.emit('denied');
  assert.equal(f.session.getState().locationStatus, 'denied');
  await f.session.useManual('Test start');
  const state = f.session.getState();
  assert.equal(state.source, 'manual'); assert.ok(state.route.durationSeconds > 0); assert.equal(state.progress, null);
  assert.equal(f.stops, 1); assert.equal(f.listeners.size, 0); assert.equal(f.following, false);
  f.session.dispose(); assert.equal(f.following, true);
});
test('travel mode and class changes replace the old route while retaining the chosen manual origin', async () => {
  const f = fixture(); await f.session.start({ to }); await f.session.useManual('START');
  const walking = f.session.getState().route.durationSeconds;
  await f.session.setMode('bike'); assert.ok(f.session.getState().route.durationSeconds < walking);
  const nearby = { lat: 25, lng: -79.999 };
  await f.session.start({ to: nearby });
  assert.deepEqual(f.session.getState().route.endpoints.to.requested, nearby);
  assert.equal(f.session.getState().originLabel, 'START'); assert.equal(f.watches, 1); f.session.dispose();
});
test('weak and outside-campus location states suppress the live estimate', async () => {
  const f = fixture(); await f.session.start({ to }); f.emit(); await flush();
  f.emit('weak'); assert.equal(f.session.getState().progress, null); assert.equal(f.session.getState().locationStatus, 'weak');
  f.emit('outside'); assert.equal(f.session.getState().progress, null); assert.equal(f.session.getState().locationStatus, 'outside');
  await f.session.useManual('not a real location'); assert.equal(f.session.getState().status, 'error'); f.session.dispose();
});
test('GPS updates from a released feed cannot overwrite a manual route or a closed class', async () => {
  const f = fixture(); await f.session.start({ to }); f.emit(); await flush();
  await f.session.useManual('START'); const manual = f.session.getState();
  f.emit('tracking', to); assert.deepEqual(f.session.getState(), manual);
  f.session.stop(); f.emit(); await flush(); assert.equal(f.session.getState().status, 'stopped'); f.session.dispose();
});
