import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { MINUTE, POLICY, PulseError, requireThat, validId, point, validateFix, withinBounds,
  usableSpot, makePlan, millis, validateAutomaticArrival } from '../shared/policy.js';

const stamp = ms => Timestamp.fromMillis(ms);
const terminal = status => ['confirmed', 'expired', 'canceled'].includes(status);

// Stage writes until all transaction reads finish. The campus revision serializes
// the small demo matching pool, including queries and concurrent opt-in/accept.
class Work {
  constructor(db, tx, campusId, now) {
    this.db = db; this.tx = tx; this.root = db.doc(`pulse/${campusId}`); this.now = now;
    this.cache = new Map(); this.writes = new Map();
  }
  ref(collection, id) { return this.root.collection(collection).doc(id); }
  async get(ref) {
    if (this.writes.has(ref.path)) return this.writes.get(ref.path).data;
    if (!this.cache.has(ref.path)) this.cache.set(ref.path, (await this.tx.get(ref)).data() ?? null);
    return this.cache.get(ref.path);
  }
  put(ref, data) { this.writes.set(ref.path, { ref, data }); }
  remove(ref) { this.put(ref, null); }
  async list(collection, field, value) {
    let query = this.root.collection(collection);
    if (field) query = query.where(field, '==', value);
    const snapshot = await this.tx.get(query.limit(POLICY.matchingPoolLimit));
    const found = new Map(snapshot.docs.map(d => { this.cache.set(d.ref.path, d.data()); return [d.id, d.data()]; }));
    for (const { ref, data } of this.writes.values()) if (ref.parent.path === this.root.collection(collection).path) {
      if (data && (!field || data[field] === value)) found.set(ref.id, data); else found.delete(ref.id);
    }
    return [...found].map(([id, data]) => ({ ...data, id }));
  }
  async state(uid, changes) {
    const ref = this.ref('memberState', uid), previous = await this.get(ref);
    this.put(ref, { uid, status: 'idle', proposalId: null, meetupId: null, ...previous, ...changes, updatedAt: stamp(this.now) });
  }
  async release(uid, proposalId, reason) {
    const ref = this.ref('availability', uid), availability = await this.get(ref);
    if (availability?.proposalId === proposalId) this.remove(ref);
    const state = await this.get(this.ref('memberState', uid));
    if (state?.proposalId === proposalId) await this.state(uid, { status: 'idle', proposalId: null, reason });
  }
  commit() { for (const { ref, data } of this.writes.values()) data === null ? this.tx.delete(ref) : this.tx.set(ref, data); }
}

export class PulseService {
  constructor(db, { clock = () => Date.now() } = {}) { this.db = db; this.clock = clock; }
  async run(campusId, task) {
    validId(campusId, 'campus');
    return this.db.runTransaction(async tx => {
      const w = new Work(this.db, tx, campusId, this.clock());
      w.campus = await w.get(w.root);
      requireThat(w.campus, 'not-found', 'This campus has not been configured for Pulse.');
      const result = await task(w);
      if (w.writes.size) w.put(w.root, { ...w.campus, revision: (w.campus.revision || 0) + 1, updatedAt: stamp(w.now) });
      w.commit(); return result;
    }, { maxAttempts: 10 });
  }
  async action(actor, campusId, action, input = {}) {
    requireThat(actor?.uid, 'unauthenticated', 'Sign in to use Pulse.');
    validId(actor.uid, 'user');
    requireThat(input && typeof input === 'object' && !Array.isArray(input), 'invalid-argument', 'Invalid Pulse request.');
    const operations = {
      optIn: w => this.optIn(w, actor, input),
      match: w => this.match(w, actor.uid),
      respond: w => this.respond(w, actor.uid, input),
      refresh: w => this.refresh(w, actor.uid),
      cancel: w => this.cancel(w, actor.uid),
      leave: w => this.leave(w, actor.uid, input),
      checkIn: w => this.checkIn(w, actor.uid, input),
    };
    requireThat(Object.hasOwn(operations, action), 'invalid-argument', 'Unknown Pulse action.');
    return this.run(campusId, operations[action]);
  }
  async optIn(w, actor, input) {
    requireThat(w.campus.enabled === true, 'failed-precondition', 'Pulse is not enabled for this campus yet.');
    validId(input.requestId, 'request');
    requireThat(input.requestId.length >= 8, 'invalid-argument', 'Use a unique request ID.');
    const existing = await w.get(w.ref('availability', actor.uid));
    const state = await this.refresh(w, actor.uid);
    if (existing?.requestId === input.requestId && millis(existing.expiresAt) > w.now
        && ['waiting', 'proposed'].includes(state.status)) return state;
    const savedState = await w.get(w.ref('memberState', actor.uid));
    requireThat(savedState?.lastOptInRequestId !== input.requestId, 'failed-precondition', 'That availability session has finished. Start a new session.');
    requireThat(!['proposed', 'confirmed'].includes(state.status), 'failed-precondition', 'Finish your current proposal or meetup first.');
    requireThat(Array.isArray(input.activities) && input.activities.length > 0 && input.activities.length <= 3
      && input.activities.every(a => POLICY.activities.includes(a)) && new Set(input.activities).size === input.activities.length,
    'invalid-argument', 'Choose coffee, food, or chat.');
    requireThat(Number.isInteger(input.minutes) && input.minutes >= 15 && input.minutes <= 120,
      'invalid-argument', 'Availability must be 15 to 120 minutes.');
    requireThat(Number.isInteger(input.maxWalkMinutes) && input.maxWalkMinutes >= 1 && input.maxWalkMinutes <= 20,
      'invalid-argument', 'Walking limit must be 1 to 20 minutes.');
    let location;
    if (input.startingSpotId) {
      const spot = await w.get(w.ref('spots', validId(input.startingSpotId, 'starting spot')));
      requireThat(usableSpot(spot), 'failed-precondition', 'Choose a verified starting place.');
      location = { ...point(spot), accuracy: 0, method: 'selected-place', capturedAt: w.now };
    } else location = { ...validateFix(input.position, w.now), method: 'device' };
    requireThat(withinBounds(location, w.campus.bounds), 'failed-precondition', 'Choose a starting point on this campus.');
    const version = randomUUID();
    w.put(w.ref('availability', actor.uid), {
      uid: actor.uid, displayName: String(actor.name || 'Student').slice(0, 40), version, requestId: input.requestId,
      activities: input.activities, maxWalkMinutes: input.maxWalkMinutes, location,
      createdAt: stamp(w.now), expiresAt: stamp(w.now + input.minutes * MINUTE), status: 'waiting', proposalId: null,
    });
    await w.state(actor.uid, { status: 'waiting', proposalId: null, meetupId: null, reason: null,
      availabilityVersion: version, lastOptInRequestId: input.requestId });
    return { status: 'waiting', expiresAt: w.now + input.minutes * MINUTE };
  }
  async match(w, uid) {
    const state = await this.refresh(w, uid);
    if (state.status !== 'waiting') return state;
    requireThat(w.campus.enabled === true, 'failed-precondition', 'Pulse matching is paused.');
    const owner = await w.get(w.ref('availability', uid));
    const pool = (await w.list('availability', 'status', 'waiting'))
      .filter(p => p.uid !== uid && p.location && millis(p.expiresAt) > w.now)
      .sort((a, b) => millis(a.createdAt) - millis(b.createdAt) || a.uid.localeCompare(b.uid));
    const spots = (await w.list('spots')).filter(usableSpot).sort((a, b) => a.id.localeCompare(b.id));
    let choice;
    for (const activity of owner.activities) for (const spot of spots) {
      const group = [owner];
      for (const candidate of pool) {
        if (group.length >= POLICY.maximumGroup) break;
        if (makePlan([...group, candidate], spot, activity, w.now)) group.push(candidate);
      }
      const plan = makePlan(group, spot, activity, w.now);
      if (plan && (!choice || group.length > choice.group.length)) choice = { group, spot, activity, plan };
    }
    if (!choice) return { status: 'waiting', reason: 'No compatible group yet.' };
    const { group, spot, activity, plan } = choice;
    const proposalId = createHash('sha256').update(group.map(p => `${p.uid}:${p.version}`).sort().join('|')).digest('hex').slice(0, 32);
    const proposal = {
      candidateIds: group.map(p => p.uid), participantNames: Object.fromEntries(group.map(p => [p.uid, p.displayName])),
      availabilityVersions: Object.fromEntries(group.map(p => [p.uid, p.version])), activity,
      spotId: spot.id, spot: { name: spot.name, instruction: spot.instruction, ...point(spot) },
      startsAt: stamp(plan.startsAt), endsAt: stamp(plan.endsAt), walkingMinutes: plan.walks,
      walkingEstimate: true, minimumAcceptances: 2, createdAt: stamp(w.now),
      responseDeadline: stamp(w.now + POLICY.responseWindowMs), responses: {}, status: 'pending', meetupId: null,
      deleteAfter: stamp(w.now + POLICY.retentionMs),
    };
    w.put(w.ref('proposals', proposalId), proposal);
    for (const person of group) {
      w.put(w.ref('availability', person.uid), { ...person, status: 'proposed', proposalId });
      await w.state(person.uid, { status: 'proposed', proposalId, meetupId: null });
    }
    return { status: 'proposed', proposalId };
  }
  async settle(w, proposalId) {
    const ref = w.ref('proposals', proposalId), proposal = await w.get(ref);
    if (!proposal || terminal(proposal.status)) return proposal;
    const resolved = proposal.candidateIds.every(uid => proposal.responses[uid]);
    if (!resolved && w.now < millis(proposal.responseDeadline)) return proposal;
    const accepted = [];
    for (const uid of proposal.candidateIds) {
      const availability = await w.get(w.ref('availability', uid));
      const state = await w.get(w.ref('memberState', uid));
      if (proposal.responses[uid]?.decision === 'accept' && availability?.version === proposal.availabilityVersions[uid]
          && availability.status === 'proposed' && availability.proposalId === proposalId
          && state?.proposalId === proposalId && state.status === 'proposed' && millis(availability.expiresAt) > w.now) accepted.push(availability);
    }
    const currentSpot = await w.get(w.ref('spots', proposal.spotId));
    // A disabled or moved spot invalidates the offer; never silently change destinations.
    const spotUnchanged = usableSpot(currentSpot) && currentSpot.latitude === proposal.spot.latitude
      && currentSpot.longitude === proposal.spot.longitude && currentSpot.instruction === proposal.spot.instruction;
    const plan = spotUnchanged && makePlan(accepted, currentSpot, proposal.activity, w.now, millis(proposal.startsAt), millis(proposal.endsAt));
    if (!plan) {
      w.put(ref, { ...proposal, status: 'expired', resolvedAt: stamp(w.now), reason: 'Not enough valid acceptances or time remaining.' });
      for (const uid of proposal.candidateIds) await w.release(uid, proposalId, 'proposal-expired');
      return { ...proposal, status: 'expired' };
    }
    const meetupId = proposalId; // Retrying confirmation always addresses the same meetup/chat.
    const participantIds = accepted.map(p => p.uid);
    w.put(w.ref('meetups', meetupId), {
      proposalId, participantIds, participantNames: Object.fromEntries(accepted.map(p => [p.uid, p.displayName])),
      activity: proposal.activity, spotId: proposal.spotId, spot: proposal.spot, status: 'confirmed',
      startsAt: stamp(plan.startsAt), endsAt: stamp(plan.endsAt), confirmedAt: stamp(w.now), walkingMinutes: plan.walks,
      walkingEstimate: true, chatClosesAt: stamp(plan.endsAt + POLICY.chatGraceMs),
      deleteAfter: stamp(plan.endsAt + POLICY.retentionMs),
    });
    w.put(ref, { ...proposal, status: 'confirmed', meetupId, resolvedAt: stamp(w.now) });
    for (const uid of proposal.candidateIds) {
      await w.release(uid, proposalId, participantIds.includes(uid) ? null : 'not-joined');
      if (participantIds.includes(uid)) await w.state(uid, { status: 'confirmed', proposalId: null, meetupId, reason: null });
    }
    return { ...proposal, status: 'confirmed', meetupId };
  }
  async respond(w, uid, input) {
    const id = validId(input.proposalId, 'proposal');
    requireThat(['accept', 'decline'].includes(input.decision), 'invalid-argument', 'Accept or decline the proposal.');
    const ref = w.ref('proposals', id), proposal = await w.get(ref);
    requireThat(proposal?.candidateIds.includes(uid), 'permission-denied', 'This proposal was not addressed to you.');
    if (proposal.status !== 'pending' || w.now >= millis(proposal.responseDeadline)) {
      await this.settle(w, id); return this.refresh(w, uid);
    }
    const prior = proposal.responses[uid];
    requireThat(!prior || prior.decision === input.decision, 'failed-precondition', 'Your response is already saved. Use cancel to withdraw.');
    if (!prior) {
      if (input.decision === 'accept') {
        const availability = await w.get(w.ref('availability', uid));
        requireThat(availability?.proposalId === id && millis(availability.expiresAt) > w.now,
          'failed-precondition', 'Your availability has ended.');
      }
      w.put(ref, { ...proposal, responses: { ...proposal.responses, [uid]: { decision: input.decision, respondedAt: stamp(w.now) } } });
      if (input.decision === 'decline') await w.release(uid, id, 'declined');
    }
    await this.settle(w, id); return this.refresh(w, uid);
  }
  async refresh(w, uid) {
    let state = await w.get(w.ref('memberState', uid));
    if (!state) return { status: 'idle', proposalId: null, meetupId: null };
    if (state.status === 'proposed' && state.proposalId) await this.settle(w, state.proposalId);
    state = await w.get(w.ref('memberState', uid));
    if (state.status === 'waiting') {
      const availability = await w.get(w.ref('availability', uid));
      if (!availability || millis(availability.expiresAt) <= w.now) {
        w.remove(w.ref('availability', uid)); await w.state(uid, { status: 'idle', reason: 'availability-expired' });
      }
    }
    if (state.status === 'confirmed' && state.meetupId) {
      const ref = w.ref('meetups', state.meetupId), meetup = await w.get(ref);
      if (!meetup || meetup.status !== 'confirmed' || millis(meetup.endsAt) <= w.now) {
        if (meetup?.status === 'confirmed') w.put(ref, { ...meetup, status: 'ended', endedAt: stamp(w.now) });
        await w.state(uid, { status: 'idle', meetupId: null, lastMeetupId: state.meetupId, reason: meetup?.status === 'canceled' ? 'meetup-canceled' : 'meetup-ended' });
      }
    }
    const current = await w.get(w.ref('memberState', uid));
    return { status: current.status, proposalId: current.proposalId, meetupId: current.meetupId, reason: current.reason ?? null };
  }
  async cancel(w, uid) {
    const state = await this.refresh(w, uid);
    requireThat(state.status !== 'confirmed', 'failed-precondition', 'Leave your confirmed meetup instead.');
    if (state.proposalId) {
      const ref = w.ref('proposals', state.proposalId), proposal = await w.get(ref);
      if (proposal?.status === 'pending') w.put(ref, { ...proposal, responses: { ...proposal.responses, [uid]: { decision: 'decline', respondedAt: stamp(w.now) } } });
      await w.release(uid, state.proposalId, 'canceled'); await this.settle(w, state.proposalId);
    }
    w.remove(w.ref('availability', uid));
    await w.state(uid, { status: 'idle', proposalId: null, meetupId: null, reason: 'canceled' });
    return { status: 'idle' };
  }
  async leave(w, uid, input) {
    const id = validId(input.meetupId, 'meetup'), ref = w.ref('meetups', id), meetup = await w.get(ref);
    requireThat(meetup?.participantIds.includes(uid) || meetup?.departedIds?.includes(uid), 'permission-denied', 'You are not in this meetup.');
    if (!meetup.participantIds.includes(uid)) return this.refresh(w, uid);
    const participantIds = meetup.participantIds.filter(p => p !== uid), participantNames = { ...meetup.participantNames };
    delete participantNames[uid];
    const canceled = meetup.status === 'confirmed' && millis(meetup.endsAt) > w.now && participantIds.length < 2;
    w.put(ref, { ...meetup, participantIds, participantNames, departedIds: [...(meetup.departedIds || []), uid],
      ...(canceled ? { status: 'canceled', reason: 'Fewer than two participants remain.', canceledAt: stamp(w.now), chatClosesAt: stamp(w.now) } : {}) });
    w.remove(ref.collection('checkIns').doc(uid));
    const state = await w.get(w.ref('memberState', uid));
    if (state?.meetupId === id) await w.state(uid, { status: 'idle', meetupId: null, reason: 'left-meetup' });
    if (canceled) for (const remaining of participantIds) {
      const remainingState = await w.get(w.ref('memberState', remaining));
      if (remainingState?.meetupId === id) await w.state(remaining, { status: 'idle', meetupId: null, lastMeetupId: id, reason: 'meetup-canceled' });
    }
    return this.refresh(w, uid);
  }
  async checkIn(w, uid, input) {
    const id = validId(input.meetupId, 'meetup'), ref = w.ref('meetups', id), meetup = await w.get(ref);
    requireThat(meetup?.participantIds.includes(uid), 'permission-denied', 'Only accepted participants can check in.');
    requireThat(meetup.status === 'confirmed' && millis(meetup.endsAt) > w.now,
      'failed-precondition', 'This meetup is no longer active.');
    requireThat(['manual', 'automatic'].includes(input.method), 'invalid-argument', 'Choose a check-in method.');
    const arrivalRef = ref.collection('checkIns').doc(uid), existing = await w.get(arrivalRef);
    if (existing) return { status: 'checked-in', method: existing.method };
    if (input.method === 'automatic') validateAutomaticArrival(input.fixes, meetup.spot, w.now, millis(meetup.confirmedAt));
    w.put(arrivalRef, { uid, method: input.method, checkedInAt: stamp(w.now) });
    return { status: 'checked-in', method: input.method };
  }
  async sweep(campusId) {
    // Bounded per pass for the demo. Correctness never depends on cleanup timing.
    await this.run(campusId, async w => {
      for (const p of await w.list('proposals', 'status', 'pending')) if (millis(p.responseDeadline) <= w.now) await this.settle(w, p.id);
      for (const a of await w.list('availability')) if (millis(a.expiresAt) <= w.now) {
        w.remove(w.ref('availability', a.uid)); await this.refresh(w, a.uid);
      }
      for (const m of await w.list('meetups', 'status', 'confirmed')) if (millis(m.endsAt) <= w.now) {
        w.put(w.ref('meetups', m.id), { ...m, status: 'ended', endedAt: stamp(w.now) });
        for (const uid of m.participantIds) await this.refresh(w, uid);
      }
    });
    const root = this.db.doc(`pulse/${campusId}`), now = stamp(this.clock());
    for (const collection of ['proposals', 'meetups']) {
      const expired = await root.collection(collection).where('deleteAfter', '<=', now).limit(25).get();
      for (const record of expired.docs) {
        // Never delete an active plan merely because a configured retention date is wrong.
        const data = record.data();
        if (data.status === 'pending' || (collection === 'meetups' && data.status === 'confirmed')
            || (data.chatClosesAt && millis(data.chatClosesAt) > this.clock())) continue;
        await this.db.recursiveDelete(record.ref);
      }
    }
  }
}
