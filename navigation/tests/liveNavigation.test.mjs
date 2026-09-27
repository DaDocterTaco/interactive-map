import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNavigation, createGraphProvider, createLiveNavigation, createBrowserLocationSource,
  normalizeLocation, createLocationResolver, createCampusLocationResolver } from '../index.js';
import { createRouteProgress } from '../routeProgress.js';

const from = { lat: 25, lng: -80 }, to = { lat: 25, lng: -79.998 };
const graph = { schemaVersion: 1, nodes: [[25, -80], [25, -79.998]], links: [[0, 1, 0]],
  profiles: [{ kind: 'footway', access: { walk: 'travel', bike: 'travel', scooter: 'travel' } }] };
const flush = () => new Promise(resolve => setImmediate(resolve));
const code = value => error => error.code === value;
function clock() {
  let time = 1000000, nextId = 0; const timers = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) { const id = ++nextId; timers.set(id, { fn, due: time + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      time += ms;
      for (const [id, entry] of [...timers]) if (entry.due <= time && timers.has(id)) { timers.delete(id); entry.fn(); }
    },
    get size() { return timers.size; },
  };
}
function harness(options = {}) {
  const time = clock(), calls = [], states = [], shown = [];
  const actual = createGraphProvider(graph);
  const navigation = options.navigation || createNavigation({ provider: { getRoute(request, opts) {
    calls.push(structuredClone(request)); return actual.getRoute(request, opts);
  } } });
  const live = createLiveNavigation({ navigation, ...time,
    onState: state => states.push(state), renderer: { show: route => shown.push(route), clear() {}, dispose() {}, updatePosition() {} },
    ...options });
  const fix = (p = from, accuracy = 5, timestamp = time.now()) => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy }, timestamp });
  return { time, calls, states, shown, live, fix };
}

test('location normalization supports browser positions, map markers, GeoJSON, and feature objects', () => {
  const examples = [from, { latitude: 25, longitude: -80 }, { lat: 25, lon: -80 },
    { coords: { latitude: 25, longitude: -80 } }, { fix: { latitude: 25, longitude: -80 } },
    { location: from }, { building: { latitude: 25, longitude: -80 } },
    { getLatLng: () => from }, { type: 'Point', coordinates: [-80, 25] },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-80, 25] } }, '25, -80'];
  for (const example of examples) assert.deepEqual(normalizeLocation(example), from);
  assert.deepEqual(normalizeLocation([-80, 25], { arrayOrder: 'lnglat' }), from);
  assert.deepEqual(normalizeLocation([25, -80], { arrayOrder: 'latlng' }), from);
  assert.throws(() => normalizeLocation([25, -80]), code('INVALID_LOCATION'));
  const cycle = {}; cycle.location = cycle;
  assert.throws(() => normalizeLocation(cycle), code('INVALID_LOCATION'));
  assert.throws(() => normalizeLocation({ type: 'Point', coordinates: ['-80', 25] }), code('INVALID_LOCATION'));
});

test('local name/code resolution is exact, case-insensitive, and ambiguity is explicit', async () => {
  const resolve = createLocationResolver({ places: [
    { id: 'GC', name: 'Graham Center', aliases: ['The Union'], ...from },
    { id: 'X', name: 'Shared name', ...from }, { id: 'Y', name: 'Shared name', ...to },
  ] });
  for (const name of [' gc ', 'GRAHAM CENTER', 'The   Union']) assert.deepEqual(await resolve(name), from);
  await assert.rejects(resolve('Shared name'), code('AMBIGUOUS_LOCATION'));
  await assert.rejects(resolve('Unknown building'), code('UNRESOLVED_LOCATION'));
  await assert.rejects(resolve(''), code('INVALID_LOCATION'));
});

test('optional address adapter is used only for unresolved text and receives cancellation', async () => {
  const queries = []; const abort = new AbortController();
  const resolve = createLocationResolver({ resolveText: async (text, { signal }) => {
    queries.push(text); assert.equal(signal, abort.signal); return { location: from };
  } });
  assert.deepEqual(await resolve('A supplied address', { signal: abort.signal }), from);
  await resolve(from); assert.deepEqual(queries, ['A supplied address']);
  abort.abort(); await assert.rejects(resolve('another', { signal: abort.signal }), code('ABORTED'));
});

test('campus names load lazily and catalog lookup can retry a failed fetch', async () => {
  let count = 0;
  const resolve = createCampusLocationResolver({ fetchImpl: async () => {
    count++; return count === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ places: [{ id: 'A', ...from }] }) };
  } });
  await resolve(from); assert.equal(count, 0);
  await assert.rejects(resolve('A'), code('DATA_UNAVAILABLE'));
  assert.deepEqual(await resolve('A'), from); await resolve('A'); assert.equal(count, 2);
});

test('navigation resolves markers before cloning and supports custom app-specific locations', async () => {
  const navigation = createNavigation({ provider: createGraphProvider(graph) });
  assert.ok((await navigation.getRoute({ from: { getLatLng: () => from }, to: { building: to } })).distanceMeters > 0);
  const custom = createNavigation({ provider: createGraphProvider(graph), resolveLocation: async input => input === 'origin' ? from : to });
  assert.ok((await custom.getRoute({ from: 'origin', to: 'destination' })).distanceMeters > 0);
});

test('remaining ETA accounts for ordered walking and riding sections', () => {
  const route = { geometry: { type: 'LineString', coordinates: [[-80, 25], [-79.998, 25]] },
    distanceMeters: 200, durationSeconds: 125,
    steps: [{ distanceMeters: 100, durationSeconds: 100 }, { distanceMeters: 100, durationSeconds: 25 }] };
  const progress = createRouteProgress(route)({ lat: 25, lng: -79.999 });
  assert.ok(Math.abs(progress.remainingDistanceMeters - 100) < 0.01);
  assert.ok(Math.abs(progress.remainingDurationSeconds - 25) < 0.01);
});

test('route matching avoids jumping to the end at a crossing close to the start', () => {
  const route = { geometry: { type: 'LineString', coordinates: [[-80, 25], [-79.998, 25], [-79.998, 25.001], [-80, 25.001], [-80, 25]] },
    distanceMeters: 620, durationSeconds: 620 };
  const progress = createRouteProgress(route)(from, { previousDistance: 5, maxProgressDelta: 30 });
  assert.ok(progress.distanceTravelledMeters < 10);
  assert.ok(progress.remainingDistanceMeters > 600);
});

test('live navigation waits for GPS and updates progress without routing on every fix', async () => {
  const h = harness(); await h.live.start({ to, mode: 'walk' });
  assert.equal(h.calls.length, 0); assert.equal(h.live.getState().status, 'waiting_location');
  h.live.updatePosition(h.fix()); await flush();
  const original = h.live.getState().progress.remainingDurationSeconds;
  h.time.advance(5000); h.live.updatePosition(h.fix({ lat: 25, lng: -79.9995 })); await flush();
  assert.equal(h.calls.length, 1);
  assert.ok(h.live.getState().progress.remainingDurationSeconds < original);
  assert.ok(h.live.getState().progress.fractionComplete > 0.2);
  h.live.dispose(); assert.equal(h.time.size, 0);
});

test('off-route rerouting needs consecutive fixes, obeys cooldown, and uses the latest position', async () => {
  const h = harness(); await h.live.start({ to }); h.live.updatePosition(h.fix()); await flush();
  h.time.advance(500); h.live.updatePosition(h.fix({ lat: 25.0003, lng: -80 }));
  assert.equal(h.calls.length, 1); assert.equal(h.live.getState().offRoute, true);
  h.time.advance(500); h.live.updatePosition(h.fix({ lat: 25.0003, lng: -79.9999 })); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.live.getState().progress, null);
  h.time.advance(4000); await flush();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1].from, { lat: 25.0003, lng: -79.9999 });
  assert.equal(h.live.getState().rerouteCount, 1); h.live.dispose();
});

test('returning to the route cancels a scheduled reroute', async () => {
  const h = harness(); await h.live.start({ to }); h.live.updatePosition(h.fix()); await flush();
  for (let i = 0; i < 2; i++) { h.time.advance(500); h.live.updatePosition(h.fix({ lat: 25.0003, lng: -80 })); }
  h.time.advance(500); h.live.updatePosition(h.fix());
  h.time.advance(4000); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.live.getState().offRoute, false); h.live.dispose();
});

test('poor accuracy and stale GPS clear live ETA; old and duplicate fixes cannot move progress', async () => {
  const h = harness(); await h.live.start({ to }); h.live.updatePosition(h.fix()); await flush();
  const initial = h.live.getState();
  assert.equal(h.live.updatePosition(h.fix(to)), false);
  assert.deepEqual(h.live.getState(), initial);
  h.time.advance(1000); assert.equal(h.live.updatePosition(h.fix(to, 120)), false);
  assert.equal(h.live.getState().locationStatus, 'weak'); assert.equal(h.live.getState().progress, null);
  h.time.advance(1000); h.live.updatePosition(h.fix());
  assert.equal(h.live.getState().locationStatus, 'good');
  h.time.advance(15001);
  assert.equal(h.live.getState().locationStatus, 'stale'); assert.equal(h.live.getState().progress, null);
  h.live.dispose();
});

test('fresh live fixes must contain a valid timestamp and reported accuracy', async () => {
  const h = harness(); await h.live.start({ to });
  assert.equal(h.live.updatePosition(from), false); assert.equal(h.calls.length, 0);
  assert.equal(h.live.updatePosition(h.fix(from, 5, h.time.now() + 2000)), false);
  assert.equal(h.live.updatePosition(h.fix(from, 5, h.time.now() - 20000)), false);
  assert.equal(h.live.getState().locationStatus, 'stale'); h.live.dispose();
});

test('arrival requires two accurate fresh confirmations near the requested destination', async () => {
  const h = harness(); await h.live.start({ to }); h.live.updatePosition(h.fix()); await flush();
  h.time.advance(10000); h.live.updatePosition(h.fix({ lat: 25, lng: -79.9988 }));
  h.time.advance(10000); h.live.updatePosition(h.fix(to));
  assert.notEqual(h.live.getState().status, 'arrived');
  h.time.advance(1000); h.live.updatePosition(h.fix(to));
  assert.equal(h.live.getState().status, 'arrived'); assert.equal(h.live.getState().active, false);
  assert.equal(h.time.size, 0); assert.equal(h.live.updatePosition(h.fix()), false); h.live.dispose();
});

test('reaching a snapped endpoint does not claim arrival at a distant building pin', async () => {
  const h = harness(); const distantPin = { lat: 25.0004, lng: -79.998 };
  await h.live.start({ to: distantPin, from: to });
  for (let i = 0; i < 4; i++) { h.time.advance(1000); h.live.updatePosition(h.fix(to)); }
  assert.notEqual(h.live.getState().status, 'arrived'); h.live.dispose();
});

test('late route results cannot revive stopped journeys or replace a newer destination', async () => {
  const pending = []; const resolveLocation = async value => normalizeLocation(value);
  const h = harness({ navigation: { resolveLocation, getRoute: request => new Promise(resolve => pending.push({ request, resolve })) } });
  await h.live.start({ to }); h.live.updatePosition(h.fix());
  const old = pending[0]; h.live.stop();
  const provider = createGraphProvider(graph); old.resolve(await provider.getRoute({ from, to })); await flush();
  assert.equal(h.live.getState().status, 'stopped'); assert.equal(h.shown.length, 0);
  await h.live.start({ to }); h.live.updatePosition(h.fix());
  await h.live.start({ to: from });
  pending[1].resolve(await provider.getRoute({ from, to })); await flush();
  assert.deepEqual(h.live.getState().destination, from); assert.equal(h.live.getState().route, null);
  h.live.dispose();
});

test('invalidating GPS cancels pending routes and fresh updates recover', async () => {
  const pending = []; const provider = createGraphProvider(graph);
  const h = harness({ navigation: { getRoute: request => new Promise(resolve => pending.push({ request, resolve })) } });
  await h.live.start({ to }); h.live.updatePosition(h.fix());
  h.live.invalidateLocation('denied'); pending[0].resolve(await provider.getRoute({ from, to })); await flush();
  assert.equal(h.live.getState().status, 'waiting_location'); assert.equal(h.live.getState().route, null);
  h.time.advance(5000); h.live.updatePosition(h.fix());
  pending[1].resolve(await provider.getRoute({ from, to })); await flush();
  assert.equal(h.live.getState().status, 'navigating'); h.live.dispose();
});

test('refresh applies mode/closure changes and cancellation prevents obsolete responses', async () => {
  const h = harness(); await h.live.start({ to }); h.live.updatePosition(h.fix()); await flush();
  const walkingTime = h.live.getState().route.durationSeconds;
  await h.live.refresh({ mode: 'bike' });
  assert.equal(h.calls.at(-1).mode, 'bike'); assert.ok(h.live.getState().route.durationSeconds < walkingTime);
  await h.live.refresh({ blockedLinkIds: ['0'] });
  assert.equal(h.live.getState().status, 'error'); assert.equal(h.live.getState().progress, null);
  h.live.dispose(); await assert.rejects(h.live.start({ to }), code('DISPOSED'));
});

function browserHarness(live) {
  const document = new EventTarget(); document.hidden = false;
  const window = new EventTarget(); const watches = [], cleared = [];
  const geolocation = { watchPosition(success, error) { const id = watches.length; watches.push({ success, error }); return id; },
    clearWatch: id => cleared.push(id) };
  const source = createBrowserLocationSource({ live, geolocation, secureContext: true, document, window });
  return { source, watches, cleared, document, window };
}

test('optional GPS source starts only explicitly, owns one watch, and ignores late callbacks', async () => {
  const h = harness(); const b = browserHarness(h.live);
  assert.equal(b.watches.length, 0); assert.equal(b.source.start(), false);
  await h.live.start({ to }); b.source.start(); b.source.start(); assert.equal(b.watches.length, 1);
  b.watches[0].success(h.fix()); await flush(); assert.equal(h.calls.length, 1);
  b.source.stop(); assert.deepEqual(b.cleared, [0]);
  h.time.advance(1000); b.watches[0].success(h.fix(to));
  assert.equal(h.live.getState().locationStatus, 'stopped');
  b.source.dispose(); h.live.dispose(); assert.equal(h.time.size, 0);
});

test('GPS source pauses when hidden and cleans up on journey stop', async () => {
  const h = harness(); const b = browserHarness(h.live); await h.live.start({ to }); b.source.start();
  b.document.hidden = true; b.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(b.source.getState().tracking, false); assert.equal(h.live.getState().locationStatus, 'paused');
  b.document.hidden = false; b.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(b.watches.length, 1); b.source.start(); assert.equal(b.watches.length, 2);
  h.live.stop(); assert.equal(b.source.getState().tracking, false); assert.deepEqual(b.cleared, [0, 1]);
  b.source.dispose(); h.live.dispose();
});

test('GPS permission denial is visible; insecure contexts do not start a watch', async () => {
  const h = harness(); const b = browserHarness(h.live); await h.live.start({ to }); b.source.start();
  b.watches[0].error({ code: 1 });
  assert.equal(h.live.getState().locationStatus, 'denied'); assert.equal(b.source.getState().tracking, false);
  const insecure = createBrowserLocationSource({ live: h.live, secureContext: false });
  assert.equal(insecure.start(), false); assert.equal(h.live.getState().locationStatus, 'insecure');
  insecure.dispose(); b.source.dispose(); h.live.dispose();
});

test('browser watch is released after automatic arrival', async () => {
  const h = harness(); const b = browserHarness(h.live);
  await h.live.start({ to: from, from }); b.source.start();
  b.watches[0].success(h.fix()); h.time.advance(1000); b.watches[0].success(h.fix());
  assert.equal(h.live.getState().status, 'arrived'); assert.equal(b.source.getState().tracking, false);
  assert.deepEqual(b.cleared, [0]); b.source.dispose(); h.live.dispose();
});

test('bundled catalog resolves names and a campus GPS trace updates live progress', async () => {
  const data = JSON.parse(await readFile(new URL('../data/campus-graph.json', import.meta.url)));
  const catalog = JSON.parse(await readFile(new URL('../data/campus-places.json', import.meta.url)));
  assert.equal(catalog.places.length, 90);
  const navigation = createNavigation({ provider: createGraphProvider(data), resolveLocation: createLocationResolver(catalog) });
  const h = harness({ navigation });
  await h.live.start({ from: 'GC', to: 'Green Library' });
  const route = h.live.getState().route; assert.ok(route.distanceMeters > 200);
  for (const [lng, lat] of route.geometry.coordinates) {
    h.time.advance(10000); h.live.updatePosition(h.fix({ lat, lng }));
  }
  assert.equal(h.live.getState().status, 'navigating');
  assert.ok(h.live.getState().progress.remainingDistanceMeters < 1);
  // This pin is off the path, so reaching the path end alone is not arrival.
  assert.notEqual(h.live.getState().status, 'arrived'); h.live.dispose();
});
