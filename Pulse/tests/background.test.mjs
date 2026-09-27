import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundState } from '../client/background-state.js';

const now = 1_000_000, user = { uid: 'alex' };
const proposal = { id: 'plan-1', status: 'pending', candidateIds: ['alex', 'sam'], responses: {}, responseDeadline: now + 45_000, spot: { name: 'Café Bustelo' } };
const proposed = { user, now, state: { status: 'proposed', proposalId: proposal.id }, proposal };

test('waiting stays resumable while active and disappears at availability expiry', () => {
  const waiting = { user, now, state: { status: 'waiting' }, availability: { expiresAt: now + 1 } };
  assert.equal(backgroundState(waiting).kind, 'waiting');
  assert.equal(backgroundState({ ...waiting, now: now + 1 }), null);
});
test('a current unresponded proposal produces an actionable deadline for its own candidate', () => {
  const notice = backgroundState(proposed);
  assert.equal(notice.kind, 'found'); assert.equal(notice.seconds, 45); assert.equal(notice.action, 'View plan');
  assert.equal(backgroundState({ ...proposed, user: { uid: 'outsider' } }), null);
  assert.equal(backgroundState({ ...proposed, state: { status: 'proposed', proposalId: 'old-plan' } }), null);
});
test('acceptance, passing and elapsed deadlines never leave an obsolete response alert', () => {
  assert.equal(backgroundState({ ...proposed, proposal: { ...proposal, responses: { alex: { decision: 'accept' } } } }).kind, 'accepted');
  assert.equal(backgroundState({ ...proposed, proposal: { ...proposal, responses: { alex: { decision: 'decline' } } } }), null);
  const elapsed = backgroundState({ ...proposed, now: now + 45_000 });
  assert.equal(elapsed.kind, 'settling'); assert.equal(elapsed.seconds, undefined);
  assert.equal(backgroundState({ ...proposed, proposal: { ...proposal, status: 'expired' } }), null);
});
test('confirmation is only announced to active members of the current unexpired meetup', () => {
  const confirmed = { user, now, state: { status: 'confirmed', meetupId: 'plan-1' }, meetup: { id: 'plan-1', status: 'confirmed', endsAt: now + 60_000, participantIds: ['alex', 'sam'], spot: { name: 'Kissing Pond benches' } } };
  assert.equal(backgroundState(confirmed).kind, 'confirmed');
  assert.equal(backgroundState({ ...confirmed, user: { uid: 'outsider' } }), null);
  assert.equal(backgroundState({ ...confirmed, now: now + 60_000 }), null);
});
test('offline and cached states replace fresh-match claims with reconnection feedback', () => {
  for (const connection of [{ online: false }, { stale: true }]) {
    const notice = backgroundState({ ...proposed, ...connection });
    assert.equal(notice.kind, 'reconnecting'); assert.equal(notice.seconds, undefined);
  }
});
test('canceling, signing out and missing plans clear background session details', () => {
  assert.equal(backgroundState({ ...proposed, user: null }), null);
  assert.equal(backgroundState({ ...proposed, state: { status: 'idle', reason: 'canceled' } }), null);
  assert.equal(backgroundState({ ...proposed, proposal: null }), null);
});
