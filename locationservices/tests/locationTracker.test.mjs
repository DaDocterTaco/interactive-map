import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocationTracker, isOnCampus } from '../locationTracker.js';

const boundary = JSON.parse(readFileSync(new URL('../campus-boundary.geojson', import.meta.url)));
const campus = { latitude: 25.75396, longitude: -80.37662 };

function setup(overrides = {}) {
  let time = 1_800_000_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const watches = new Map();
  const cleared = [];
  let nextWatch = 0;
  const geolocation = {
    watchPosition(success, error, options) {
      const id = nextWatch++;
      watches.set(id, { success, error, options });
      return id;
    },
    clearWatch(id) { cleared.push(id); watches.delete(id); },
  };
  const changes = [];
  const tracker = createLocationTracker({
    geolocation, secureContext: true, boundary,
    now: () => time,
    setTimer(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    onChange: state => changes.push(state),
    ...overrides,
  });
  function fix(coords = {}, timestamp = time, id = nextWatch - 1) {
    watches.get(id)?.success({
      coords: { ...campus, accuracy: 12, ...coords }, timestamp,
    });
  }
  function advance(ms) {
    const target = time + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      timers.delete(next[0]);
      time = next[1].due;
      next[1].callback();
    }
    time = target;
  }
  return { tracker, geolocation, watches, cleared, changes, fix, advance,
    fail: (code, id = nextWatch - 1) => watches.get(id)?.error({ code }),
    now: () => time };
}

test('campus polygon accepts the map center and rejects distant coordinates', () => {
  assert.equal(isOnCampus(campus.latitude, campus.longitude, boundary), true);
  assert.equal(isOnCampus(25.8, -80.4, boundary), false);
});

test('tracking starts only on request, uses one watch, and clears it on stop', () => {
  const h = setup();
  assert.equal(h.watches.size, 0);
  h.tracker.start();
  h.tracker.start();
  assert.equal(h.watches.size, 1);
  assert.deepEqual([...h.watches.values()][0].options,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  h.fix();
  assert.equal(h.tracker.getState().status, 'tracking');
  assert.equal(h.tracker.getState().markerVisible, true);
  h.tracker.stop();
  assert.equal(h.watches.size, 0);
  assert.deepEqual(h.cleared, [0]);
  assert.equal(h.tracker.getState().markerVisible, false);
});

test('weak, outside, and stale fixes do not claim precise live positioning', () => {
  const h = setup();
  h.tracker.start();
  h.fix({ accuracy: 180 });
  assert.equal(h.tracker.getState().status, 'weak');
  assert.equal(h.tracker.getState().fix.accuracy, 180);
  h.tracker.stop();
  h.tracker.start();
  h.fix({ latitude: 25.8 });
  assert.equal(h.tracker.getState().status, 'outside');
  assert.equal(h.tracker.getState().markerVisible, false);
  h.advance(30000);
  assert.equal(h.tracker.getState().status, 'stale');
  assert.equal(h.tracker.getState().markerVisible, false);
  assert.equal(h.watches.size, 1);
  h.fix();
  assert.equal(h.tracker.getState().status, 'tracking');
});

test('isolated large spikes, including off-campus jumps, do not move the shared fix', () => {
  const h = setup();
  h.tracker.start();
  h.fix();
  const initial = h.tracker.getState().fix;
  for (const latitude of [25.755, 25.8, 25.751, 25.82]) {
    h.advance(1000);
    h.fix({ latitude, accuracy: 5 });
    assert.deepEqual(h.tracker.getState().fix, initial);
    assert.equal(h.tracker.getState().status, 'tracking');
  }
  h.advance(1000);
  h.fix();
  assert.equal(h.tracker.getState().fix.timestamp, h.now());
});

test('stationary noise stays still, while a continuous walk advances without large lag', () => {
  const h = setup();
  h.tracker.start();
  h.fix({ accuracy: 6 });
  for (const meters of [1, -1, 1.5, -1.5, 0]) {
    h.advance(1000);
    h.fix({ latitude: campus.latitude + meters / 111195, accuracy: 6 });
    assert.equal(h.tracker.getState().fix.latitude, campus.latitude);
  }
  let previous = campus.latitude;
  for (let meters = 2; meters <= 40; meters += 2) {
    h.advance(1000);
    h.fix({ latitude: campus.latitude + meters / 111195, accuracy: 6 });
    const fix = h.tracker.getState().fix;
    assert.ok(fix.latitude >= previous);
    assert.ok((campus.latitude + meters / 111195 - fix.latitude) * 111195 < 5);
    assert.ok(fix.accuracy >= 6);
    previous = fix.latitude;
  }
});

test('repeated consistent fixes confirm a real relocation after two seconds', () => {
  const h = setup();
  h.tracker.start();
  h.fix();
  const initial = h.tracker.getState().fix;
  for (let i = 0; i < 3; i++) {
    h.advance(1000);
    h.fix({ latitude: 25.8, accuracy: 8 });
    if (i < 2) assert.deepEqual(h.tracker.getState().fix, initial);
  }
  assert.equal(h.tracker.getState().status, 'outside');
  assert.equal(h.tracker.getState().fix.latitude, 25.8);
});

test('duplicates cannot confirm jumps and rejected readings cannot postpone staleness', () => {
  const h = setup();
  h.tracker.start();
  h.fix();
  const initial = h.tracker.getState().fix;
  h.advance(1000);
  for (let i = 0; i < 10; i++) h.fix({ latitude: 25.8 });
  assert.deepEqual(h.tracker.getState().fix, initial);
  for (let i = 0; i < 28; i++) {
    h.advance(1000);
    h.fix({ latitude: i % 2 ? 25.81 : 25.79 });
  }
  h.advance(1000);
  assert.equal(h.tracker.getState().status, 'stale');
  assert.equal(h.tracker.getState().markerVisible, false);
  h.fix({ latitude: 25.754 });
  assert.equal(h.tracker.getState().status, 'tracking');
  assert.equal(h.tracker.getState().fix.latitude, 25.754);
});

test('poor accuracy does not drag a good fix, and pause/restart clears filtering history', () => {
  const h = setup();
  h.tracker.start();
  h.fix({ accuracy: 5 });
  const initial = h.tracker.getState().fix;
  for (let i = 0; i < 4; i++) {
    h.advance(1000);
    h.fix({ latitude: 25.7543, accuracy: 250 });
    assert.deepEqual(h.tracker.getState().fix, initial);
  }
  h.tracker.pause();
  h.tracker.start();
  h.fix({ latitude: 25.7549 });
  assert.equal(h.tracker.getState().fix.latitude, 25.7549);
});

test('older fixes cannot move the marker backwards', () => {
  const h = setup();
  h.tracker.start();
  h.fix();
  h.fix({ accuracy: 200 }, h.now() - 1000);
  assert.equal(h.tracker.getState().status, 'tracking');
  assert.equal(h.tracker.getState().fix.accuracy, 12);
});

test('permission errors and page pause clear the active watch', () => {
  const h = setup();
  h.tracker.start();
  h.fail(1);
  assert.equal(h.tracker.getState().status, 'denied');
  assert.equal(h.watches.size, 0);
  h.tracker.start();
  h.fix();
  h.tracker.pause();
  assert.equal(h.tracker.getState().status, 'paused');
  assert.equal(h.watches.size, 0);
});

test('insecure, unsupported, and missing boundary states never request location', () => {
  for (const [options, status] of [
    [{ secureContext: false }, 'insecure'],
    [{ geolocation: null }, 'unsupported'],
    [{ boundary: null }, 'boundary-error'],
  ]) {
    const h = setup(options);
    h.tracker.start();
    assert.equal(h.tracker.getState().status, status);
    assert.equal(h.watches.size, 0);
  }
});
