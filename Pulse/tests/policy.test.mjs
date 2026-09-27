import test from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, distanceMeters, makePlan, validateAutomaticArrival, validateFix } from '../shared/policy.js';

const now = 1_800_000_000_000;
const spot = { latitude: 25.7565, longitude: -80.3724, enabled: true, verified: true, instruction: 'Test only', activities: ['coffee', 'chat'] };
const person = (uid, overrides = {}) => ({ uid, location: { latitude: spot.latitude, longitude: spot.longitude, accuracy: 5 },
  activities: ['coffee'], expiresAt: now + 45 * MINUTE, maxWalkMinutes: 5, ...overrides });
test('matching requires a useful interval, common activity and every walking limit', () => {
  const a = person('a'), b = person('b');
  const plan = makePlan([a, b], spot, 'coffee', now);
  assert.equal(plan.endsAt - plan.startsAt, 25 * MINUTE);
  assert.equal(makePlan([a, person('b', { activities: ['chat'] })], spot, 'coffee', now), null);
  assert.equal(makePlan([a, person('b', { expiresAt: now + 10 * MINUTE })], spot, 'coffee', now), null);
  assert.equal(makePlan([a, person('b', { location: { latitude: 25.76, longitude: -80.38 }, maxWalkMinutes: 1 })], spot, 'coffee', now), null);
  assert.equal(makePlan([a, b], { ...spot, verified: false }, 'coffee', now), null);
});
test('confirmation consumes decision time and never extends the original offered end', () => {
  const people = [person('a'), person('b')], first = makePlan(people, spot, 'coffee', now);
  const later = makePlan(people, spot, 'coffee', now + 20 * MINUTE, first.startsAt, first.endsAt);
  assert.equal(later, null);
  const timely = makePlan(people, spot, 'coffee', now + MINUTE, first.startsAt, first.endsAt);
  assert.equal(timely.endsAt, first.endsAt);
});
test('arrival needs two distinct accurate fixes over time after confirmation', () => {
  const fixes = [now - 11_000, now].map(capturedAt => ({ latitude: spot.latitude, longitude: spot.longitude, accuracy: 10, capturedAt }));
  assert.equal(validateAutomaticArrival(fixes, spot, now, now - 12_000), true);
  for (const altered of [
    [fixes[1], fixes[1]],
    [{ ...fixes[0], capturedAt: now - 20_000 }, fixes[1]],
    fixes.map(f => ({ ...f, accuracy: 30 })),
    fixes.map(f => ({ ...f, latitude: f.latitude + 0.001 })),
  ]) assert.throws(() => validateAutomaticArrival(altered, spot, now, now - 60_000));
  assert.throws(() => validateAutomaticArrival(fixes, spot, now, now - 5_000));
});
test('fresh fixes reject invalid coordinates, future readings and poor accuracy', () => {
  const fix = { latitude: 25.75, longitude: -80.37, accuracy: 20, capturedAt: now };
  for (const change of [{ latitude: NaN }, { longitude: 999 }, { accuracy: -1 }, { accuracy: 101 }, { capturedAt: now + 60_000 }]) {
    assert.throws(() => validateFix({ ...fix, ...change }, now));
  }
  assert.equal(distanceMeters(spot, spot), 0);
});
