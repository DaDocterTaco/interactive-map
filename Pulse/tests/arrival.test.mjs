import test from 'node:test';
import assert from 'node:assert/strict';
import { startArrival } from '../client/arrival.js';

function fixture() {
  let success, failure, time = 100_000, cleared = [];
  const spot = { latitude: 25.7565, longitude: -80.3724 }, calls = [], statuses = [];
  const stop = startArrival({ spot, confirmedAt: time - 1000, now: () => time,
    geolocation: { watchPosition(ok, error) { success = ok; failure = error; return 42; }, clearWatch(id) { cleared.push(id); } },
    onArrive: async fixes => calls.push(fixes), onStatus: text => statuses.push(text) });
  return { calls, cleared, statuses, stop, failure: () => failure(), fix: async (elapsed = 0, overrides = {}) => {
    time += elapsed; await success({ coords: { ...spot, accuracy: 5, ...overrides }, timestamp: time });
  } };
}
test('arrival waits for two accurate distinct readings spanning ten seconds, then stops', async () => {
  const f = fixture(); await f.fix(); await f.fix(); await f.fix(9000); assert.equal(f.calls.length, 0);
  await f.fix(1000); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].length, 2);
  assert.deepEqual(f.cleared, [42]); await f.fix(1000); assert.equal(f.calls.length, 1);
});
test('inaccurate or distant readings reset dwell and never check in', async () => {
  const f = fixture(); await f.fix(); await f.fix(10000, { accuracy: 100 }); assert.equal(f.calls.length, 0);
  await f.fix(1000); await f.fix(10000, { latitude: 25.76 }); assert.equal(f.calls.length, 0);
  await f.fix(1000); await f.fix(10000); assert.equal(f.calls.length, 1);
});
test('stopping on leave or hidden page discards fixes; permission errors stop the watcher', async () => {
  const f = fixture(); await f.fix(); f.stop(); await f.fix(10000); assert.equal(f.calls.length, 0); assert.deepEqual(f.cleared, [42]);
  const denied = fixture(); denied.failure(); await denied.fix(); assert.deepEqual(denied.cleared, [42]); assert.equal(denied.calls.length, 0);
});
