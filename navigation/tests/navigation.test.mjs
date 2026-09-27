import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNavigation, createGraphProvider, createCampusProvider, createRouteController,
  createLeafletRenderer } from '../index.js';

const profile = (overrides = {}) => ({ kind: 'footway', access: { walk: 'travel', bike: 'travel', scooter: 'travel' }, ...overrides });
const fixture = (overrides = {}) => ({ schemaVersion: 1,
  nodes: [[25, -80], [25, -79.999], [25.001, -79.999], [25.001, -80]],
  profiles: [profile()], links: [[0, 1, 0], [1, 2, 0], [0, 3, 0], [3, 2, 0]], ...overrides });
const location = (graph, i) => ({ lat: graph.nodes[i][0], lng: graph.nodes[i][1] });
const req = (graph, from = 0, to = 2, options = {}) => ({ from: location(graph, from), to: location(graph, to), ...options });
const code = expected => error => error.code === expected;
const lineGraph = (p = profile()) => fixture({ nodes: [[25, -80], [25, -79.999]], links: [[0, 1, 0]], profiles: [p] });

test('routes along connected edges and emits GeoJSON in longitude/latitude order', async () => {
  const graph = fixture(); const provider = createGraphProvider(graph);
  const route = await provider.getRoute(req(graph));
  assert.ok(route.distanceMeters > 200 && route.distanceMeters < 220);
  assert.ok(Math.abs(route.durationSeconds - route.distanceMeters / 1.34112) < 1e-8);
  assert.deepEqual(route.geometry.coordinates[0], [-80, 25]);
  assert.deepEqual(route.geometry.coordinates.at(-1), [-79.999, 25.001]);
  assert.equal(route.geometry.coordinates.length, 3);
});

test('fastest accounts for slower steps while shortest minimizes actual distance', async () => {
  const graph = fixture({ nodes: [[25, -80], [25, -79.999], [25.0006, -79.9995]],
    profiles: [profile({ kind: 'steps' }), profile()], links: [[0, 1, 0], [0, 2, 1], [2, 1, 1]] });
  const provider = createGraphProvider(graph);
  const shortest = await provider.getRoute(req(graph, 0, 1, { preference: 'shortest' }));
  const fastest = await provider.getRoute(req(graph, 0, 1));
  assert.ok(shortest.distanceMeters < fastest.distanceMeters);
  assert.ok(fastest.durationSeconds < shortest.durationSeconds);
  assert.deepEqual(shortest.linkIds, ['0']);
  assert.deepEqual(fastest.linkIds, ['1', '2']);
});

test('flat paths use 3 mph walking and 15 mph biking/scooting, with configurable overrides', async () => {
  const graph = lineGraph(); const provider = createGraphProvider(graph);
  const routes = await Promise.all(['walk', 'bike', 'scooter'].map(mode => provider.getRoute(req(graph, 0, 1, { mode }))));
  // One mile takes 20 minutes at 3 mph and 4 minutes at 15 mph.
  for (const [i, secondsPerMile] of [1200, 240, 240].entries()) {
    assert.ok(Math.abs(routes[i].durationSeconds / routes[i].distanceMeters * 1609.344 - secondsPerMile) < 1e-8);
  }
  assert.equal(routes[1].durationSeconds, routes[2].durationSeconds);
  const slow = await provider.getRoute(req(graph, 0, 1, { mode: 'bike', speeds: { bike: 1 } }));
  assert.equal(slow.durationSeconds, slow.distanceMeters);
});

test('partial segments and identical positions do not detour through whole endpoints', async () => {
  const graph = lineGraph(); const provider = createGraphProvider(graph);
  const full = await provider.getRoute(req(graph, 0, 1));
  const from = { lat: 25, lng: -79.9998 }, to = { lat: 25, lng: -79.9993 };
  const partial = await provider.getRoute({ from, to });
  assert.ok(Math.abs(partial.distanceMeters / full.distanceMeters - 0.5) < 1e-6);
  const same = await provider.getRoute({ from, to: from });
  assert.equal(same.distanceMeters, 0); assert.equal(same.durationSeconds, 0);
  assert.equal(same.geometry.coordinates.length, 2);
});

test('one-way direction applies to partial edges and full edges per mode', async () => {
  const graph = lineGraph(profile({ direction: { bike: 1, walk: 0, scooter: -1 } }));
  const provider = createGraphProvider(graph);
  await provider.getRoute(req(graph, 0, 1, { mode: 'bike' }));
  await assert.rejects(provider.getRoute(req(graph, 1, 0, { mode: 'bike' })), code('NO_ROUTE'));
  await provider.getRoute(req(graph, 1, 0, { mode: 'walk' }));
  await provider.getRoute(req(graph, 1, 0, { mode: 'scooter' }));
  await assert.rejects(provider.getRoute({ from: { lat: 25, lng: -79.9993 }, to: { lat: 25, lng: -79.9998 }, mode: 'bike' }), code('NO_ROUTE'));
});

test('bike and scooter avoid steps; step-free walking is explicit', async () => {
  const graph = lineGraph(profile({ kind: 'steps' })); const provider = createGraphProvider(graph);
  await provider.getRoute(req(graph, 0, 1));
  for (const options of [{ mode: 'bike' }, { mode: 'scooter' }, { avoidSteps: true }]) {
    await assert.rejects(provider.getRoute(req(graph, 0, 1, options)), code('OUTSIDE_NETWORK'));
  }
});

test('unknown riding permissions default to dismount; opt-in estimates are labeled', async () => {
  const graph = lineGraph(profile({ access: { walk: 'travel', bike: 'unverified', scooter: 'no' } }));
  const provider = createGraphProvider(graph);
  const conservative = await provider.getRoute(req(graph, 0, 1, { mode: 'bike' }));
  const estimated = await provider.getRoute(req(graph, 0, 1, { mode: 'bike', allowUnverifiedRiding: true }));
  assert.equal(conservative.steps[0].activity, 'dismount');
  assert.equal(estimated.steps[0].activity, 'bike');
  assert.ok(estimated.durationSeconds < conservative.durationSeconds);
  assert.ok(estimated.warnings.some(w => w.includes('provisional')));
  await assert.rejects(provider.getRoute(req(graph, 0, 1, { mode: 'scooter', allowUnverifiedRiding: true })), code('OUTSIDE_NETWORK'));
});

test('dismount sections follow pedestrian direction, not vehicle direction', async () => {
  const graph = lineGraph(profile({ access: { walk: 'travel', bike: 'dismount', scooter: 'dismount' }, direction: { bike: 1 } }));
  const route = await createGraphProvider(graph).getRoute(req(graph, 1, 0, { mode: 'bike' }));
  assert.equal(route.steps[0].activity, 'dismount');
  for (const mode of ['bike','scooter']) {
    const ridingEstimate = await createGraphProvider(graph).getRoute(req(graph, 1, 0, { mode, allowUnverifiedRiding:true }));
    assert.equal(ridingEstimate.steps[0].activity, 'dismount');
    assert.ok(Math.abs(ridingEstimate.durationSeconds - ridingEstimate.distanceMeters / 1.34112) < 1e-8);
  }
});

test('disconnected paths and visual crossings never produce an invented route', async () => {
  const graph = fixture({ links: [[0, 1, 0], [2, 3, 0]] });
  await assert.rejects(createGraphProvider(graph).getRoute(req(graph)), code('NO_ROUTE'));
  const crossing = fixture({ nodes: [[25, -80], [25.001, -79.999], [25, -79.999], [25.001, -80]], links: [[0, 1, 0], [2, 3, 0]] });
  await assert.rejects(createGraphProvider(crossing).getRoute(req(crossing)), code('NO_ROUTE'));
});

test('closure exclusions detour through other edges without mutating the graph', async () => {
  const graph = fixture(); const original = structuredClone(graph); const provider = createGraphProvider(graph);
  const route = await provider.getRoute(req(graph, 0, 2, { blockedLinkIds: ['0'] }));
  assert.ok(!route.linkIds.includes('0')); assert.deepEqual(route.linkIds, ['2', '3']);
  assert.deepEqual(graph, original);
});

test('off-path points return explicit offsets and no fabricated connector geometry', async () => {
  const graph = lineGraph(); const provider = createGraphProvider(graph);
  const from = { lat: 25.0001, lng: -79.9998 };
  const route = await provider.getRoute({ from, to: location(graph, 1) });
  assert.ok(route.endpoints.from.offsetMeters > 10);
  assert.equal(route.geometry.coordinates[0][1], 25);
  assert.ok(route.warnings.some(w => w.includes('entrance')));
  await assert.rejects(provider.getRoute({ from, to: location(graph, 1), maxSnapMeters: 5 }), code('OUTSIDE_NETWORK'));
});

test('invalid inputs fail with stable error codes', async () => {
  const graph = lineGraph(); const nav = createNavigation({ provider: createGraphProvider(graph) });
  for (const from of [null, [25, -80], { lat: '25', lng: -80 }, { lat: NaN, lng: -80 }, { lat: 95, lng: 0 }]) {
    await assert.rejects(nav.getRoute({ from, to: location(graph, 1) }), code('INVALID_LOCATION'));
  }
  await assert.rejects(nav.getRoute(req(graph, 0, 1, { mode: 'car' })), code('INVALID_MODE'));
  for (const options of [{ speeds: { bike: 0 } }, { preference: 'safest' }, { maxSnapMeters: Infinity }, { allowUnverifiedRiding: 'true' }]) {
    await assert.rejects(nav.getRoute(req(graph, 0, 1, options)), code('INVALID_OPTIONS'));
  }
  assert.throws(() => createGraphProvider({ schemaVersion: 99 }), code('INVALID_GRAPH'));
});

test('named location-service coordinates are accepted without array ambiguity', async () => {
  const graph = lineGraph();
  const route = await createNavigation({ provider: createGraphProvider(graph) }).getRoute({
    from: { latitude: 25, longitude: -80, accuracy: 10 }, to: { lat: 25, lon: -79.999 },
  });
  assert.ok(route.distanceMeters > 0);
});

test('bounded cache preserves exact locations, modes, options and independent results', async () => {
  const graph = fixture(); const actual = createGraphProvider(graph); let calls = 0;
  const nav = createNavigation({ cacheSize: 2, provider: { async getRoute(r) { calls++; return actual.getRoute(r); } } });
  const first = await nav.getRoute(req(graph));
  first.geometry.coordinates[0][0] = 0;
  const cached = await nav.getRoute(req(graph));
  assert.equal(calls, 1); assert.equal(cached.geometry.coordinates[0][0], -80);
  await nav.getRoute(req(graph, 0, 2, { mode: 'bike' }));
  await nav.getRoute(req(graph, 0, 2, { blockedLinkIds: ['0'] }));
  await nav.getRoute(req(graph)); assert.equal(calls, 4);
  nav.clearCache(); await nav.getRoute(req(graph)); assert.equal(calls, 5);
});

test('campus provider loads lazily, once, and retries failures including synchronous fetch errors', async () => {
  const graph = lineGraph(); let calls = 0;
  const provider = createCampusProvider({ fetchImpl: () => {
    calls++; if (calls === 1) throw new Error('Offline');
    return Promise.resolve({ ok: true, json: async () => graph });
  } });
  assert.equal(calls, 0);
  await assert.rejects(provider.getRoute(req(graph, 0, 1)), code('DATA_UNAVAILABLE'));
  await Promise.all([provider.getRoute(req(graph, 0, 1)), provider.getRoute(req(graph, 1, 0))]);
  assert.equal(calls, 2);
});

test('cancellation resolves promptly even if an external provider ignores its signal', async () => {
  const graph = lineGraph(); const abort = new AbortController();
  const nav = createNavigation({ provider: { getRoute: () => new Promise(() => {}) } });
  const promise = nav.getRoute(req(graph, 0, 1), { signal: abort.signal });
  abort.abort();
  await assert.rejects(promise, code('ABORTED'));
  await assert.rejects(nav.getRoute(req(graph, 0, 1), { signal: abort.signal }), code('ABORTED'));
});

test('a cancelled caller cannot cancel a shared campus-data load', async () => {
  const graph = lineGraph(); let release;
  const provider = createCampusProvider({ fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  const nav = createNavigation({ provider }); const abort = new AbortController();
  const first = nav.getRoute(req(graph, 0, 1), { signal: abort.signal });
  const second = nav.getRoute(req(graph, 1, 0));
  await new Promise(resolve => setImmediate(resolve));
  abort.abort(); await assert.rejects(first, code('ABORTED'));
  release({ ok: true, json: async () => graph });
  assert.ok((await second).distanceMeters > 0);
});

test('controller prevents obsolete successes and errors from overwriting the newest route', async () => {
  const pending = []; const shown = [], states = [];
  const controller = createRouteController({ navigation: { getRoute: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    renderer: { clear() {}, show: route => shown.push(route.id), dispose() {} }, onState: s => states.push(s.status) });
  const first = controller.route({}), second = controller.route({});
  pending[1].resolve({ id: 2 }); await second;
  pending[0].reject(new Error('Old failure')); assert.equal(await first, null);
  assert.deepEqual(shown, [2]); assert.equal(states.at(-1), 'ready');
  const third = controller.route({}); controller.clear(); pending[2].resolve({ id: 3 });
  assert.equal(await third, null); assert.deepEqual(shown, [2]);
  controller.dispose(); await assert.rejects(controller.route({}), code('DISPOSED'));
});

test('Leaflet adapter scopes all its layers and converts coordinates correctly', () => {
  const groups = [], paths = [], removed = [], fits = [];
  const group = { addTo() { groups.push(this); return this; }, clearLayers() {} };
  const L = { layerGroup: () => group, polyline: (points, options) => {
    paths.push({ points, options }); return { addTo: target => { assert.equal(target, group); return { getBounds: () => ({ isValid: () => true }) }; } };
  }, circleMarker: () => ({ bindTooltip: () => ({ addTo: target => assert.equal(target, group) }) }) };
  const map = { fitBounds: (...args) => fits.push(args), removeLayer: layer => removed.push(layer) };
  const renderer = createLeafletRenderer({ map, L });
  renderer.show({ geometry: { coordinates: [[-80, 25], [-79.99, 25.01]] } });
  assert.deepEqual(paths[0].points, [[25, -80], [25.01, -79.99]]);
  assert.equal(groups.length, 1); assert.equal(fits.length, 1);
  renderer.dispose(); renderer.dispose(); assert.deepEqual(removed, [group]);
});

test('bundled campus paths connect all demo buildings in all modes', async () => {
  const graph = JSON.parse(await readFile(new URL('../data/campus-graph.json', import.meta.url)));
  const { places } = JSON.parse(await readFile(new URL('../data/demo-places.json', import.meta.url)));
  const provider = createGraphProvider(graph);
  let total = 0;
  for (const mode of ['walk', 'bike', 'scooter']) for (const from of places) for (const to of places) {
    const route = await provider.getRoute({ from, to, mode });
    assert.ok(Number.isFinite(route.durationSeconds));
    assert.ok(route.endpoints.from.offsetMeters <= 60 && route.endpoints.to.offsetMeters <= 60);
    assert.ok(route.geometry.coordinates.every(([lng, lat]) => lng < -80 && lat > 25));
    total++;
  }
  assert.equal(total, 192);
});
