import test from 'node:test';
import assert from 'node:assert/strict';
import { campusReadiness, canStartPulse, needsPulseSync, connectionMessage, isConnectionFailure } from '../client/readiness.js';

const ready = { exists: true, fromCache: false, data: { enabled: true } };
const disabled = { ...ready, data: { enabled: false } };
const missing = { exists: false, fromCache: false, data: null };
const spot = { enabled: true, verified: true, instruction: 'Meet here.', latitude: 25.7565, longitude: -80.3724, activities: ['coffee'] };

test('a campus without setup never allows callable polling, even with a stale active state', () => {
  for (const status of ['idle', 'waiting', 'proposed', 'confirmed']) assert.equal(needsPulseSync(missing, true, { status }), false);
  assert.equal(campusReadiness(missing), 'unavailable');
  assert.equal(canStartPulse(missing, true, [spot]), false);
});
test('sign-in, opening, retry, and reconnect while idle do not call an undeployed function', () => {
  assert.equal(needsPulseSync(ready, true, { status: 'idle' }), false);
  assert.equal(needsPulseSync(ready, false, { status: 'waiting' }), false);
  assert.equal(needsPulseSync(ready, true, { status: 'waiting' }), true);
});
test('cached missing setup stays loading and cannot start a session', () => {
  const cached = { ...missing, fromCache: true };
  assert.equal(campusReadiness(cached), 'loading');
  assert.equal(canStartPulse(cached, true, [spot]), false);
  assert.equal(needsPulseSync({ ...ready, fromCache: true }, true, { status: 'confirmed' }), false);
});
test('disabled campuses block new matching but allow existing sessions to settle and leave', () => {
  assert.equal(campusReadiness(disabled), 'unavailable');
  assert.equal(canStartPulse(disabled, true, [spot]), false);
  assert.equal(needsPulseSync(disabled, true, { status: 'confirmed' }), true);
});
test('new availability requires an enabled campus and at least one usable spot', () => {
  assert.equal(canStartPulse(ready, false, [spot]), false);
  assert.equal(canStartPulse(ready, true, []), false);
  assert.equal(canStartPulse(ready, true, [{ ...spot, verified: false }]), false);
  assert.equal(canStartPulse(ready, true, [spot]), true);
});
test('only a real connection failure on an existing session shows the stale-plan banner', () => {
  assert.equal(isConnectionFailure({ code: 'functions/internal' }), false);
  assert.equal(isConnectionFailure({ code: 'functions/not-found' }), false);
  assert.equal(isConnectionFailure({ code: 'functions/unavailable' }), true);
  assert.equal(connectionMessage({ online: true, stale: true, active: false }), '');
  assert.match(connectionMessage({ online: true, stale: true, active: true }), /Reconnecting/);
  assert.doesNotMatch(connectionMessage({ online: false, active: false }), /plan/);
});
