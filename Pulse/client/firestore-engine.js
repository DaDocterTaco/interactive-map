import { MINUTE, POLICY, PulseError, requireThat, validId, millis, usableSpot, point, validateFix,
  withinBounds, walkingMinutes, validateAutomaticArrival } from '../shared/policy.js';

// The SDK is injected so emulator tests exercise the exact browser implementation.
// Only coarse walking estimates leave the device. No GPS fixes are persisted.
export function createFirestoreEngine({ db, sdk: f, actor, campusId = 'mmc', clock = () => Date.now() }) {
  validId(campusId, 'campus');
  const root = f.doc(db, 'pulse', campusId);
  const ref = (kind, id) => f.doc(root, kind, id);
  const data = snapshot => snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
  const read = async reference => data(await f.getDocFromServer(reference));
  const stamp = ms => f.Timestamp.fromMillis(ms);
  const server = () => f.serverTimestamp();
  const account = () => { const a = actor(); requireThat(a?.uid, 'unauthenticated', 'Sign in to use Pulse.'); return a; };
  const accepted = p => p.candidateIds.filter(uid => p.responses[uid]?.decision === 'accept');
  const active = p => (p.participantIds || []).filter(uid => !(p.departedIds || []).includes(uid));
  const result = (a, p) => {
    if (!a) return { status: 'idle' };
    if (a.proposalId && p?.status === 'confirmed') {
      const joined = active(p).includes(a.uid), canceled = active(p).length < 2;
      if (joined && !canceled && millis(p.endsAt) > clock()) return { status: 'confirmed', meetupId: p.id, proposalId: null };
      return { status: 'idle', meetupId: null, proposalId: null,
        ...(joined ? { lastMeetupId: p.id, reason: canceled ? 'meetup-canceled' : 'meetup-ended' } : { reason: 'not-joined' }) };
    }
    if (a.proposalId && p?.status === 'pending' && p.responses[a.uid]?.decision !== 'decline') return { status: 'proposed', proposalId: p.id, meetupId: null };
    if (a.status === 'waiting' && millis(a.expiresAt) > clock()) return { status: 'waiting', proposalId: null, meetupId: null };
    return { status: 'idle', proposalId: null, meetupId: null, reason: p ? 'proposal-expired' : 'availability-expired' };
  };
  function plan(people, spot, activity, now) {
    if (people.length < 2 || people.length > 4 || !usableSpot(spot) || !spot.activities.includes(activity)) return null;
    if (!people.every(a => a.activities.includes(activity) && Number.isInteger(a.walks[spot.id]) && a.walks[spot.id] >= 1 && a.walks[spot.id] <= 20)) return null;
    const walks = Object.fromEntries(people.map(a => [a.uid, a.walks[spot.id]]));
    const startsAt = now + POLICY.responseWindowMs + POLICY.departureBufferMs + Math.max(...Object.values(walks)) * MINUTE + 2000;
    const endsAt = Math.min(startsAt + POLICY.maximumTogetherMs, ...people.map(a => millis(a.expiresAt) - POLICY.commitmentBufferMs));
    return endsAt - startsAt >= POLICY.minimumTogetherMs ? { startsAt, endsAt, walks } : null;
  }
  async function settle(id) {
    return f.runTransaction(db, async tx => {
      const p = data(await tx.get(ref('proposals', id)));
      if (!p || p.status !== 'pending') return p;
      const now = clock();
      if (now < millis(p.responseDeadline) && !p.candidateIds.every(uid => p.responses[uid])) return p;
      const spot = data(await tx.get(ref('spots', p.spotId))), ids = accepted(p);
      const startsAt = Math.max(millis(p.startsAt), now + POLICY.departureBufferMs + Math.max(0, ...ids.map(uid => p.walkingMinutes[uid])) * MINUTE + 2000);
      const sameSpot = usableSpot(spot) && spot.activities.includes(p.activity) && ['name', 'instruction', 'latitude', 'longitude'].every(key => spot[key] === p.spot[key]);
      const good = ids.length >= 2 && sameSpot && millis(p.endsAt) - startsAt >= POLICY.minimumTogetherMs;
      const change = good ? { status: 'confirmed', participantIds: ids, startsAt: stamp(startsAt), confirmedAt: server() }
        : { status: 'expired' };
      tx.update(ref('proposals', id), { ...change, resolvedAt: server(), updatedAt: server() });
      return { ...p, ...change, confirmedAt: good ? stamp(now) : null };
    });
  }
  async function refresh(uid = account().uid) {
    const a = await read(ref('availability', uid));
    let p = a?.proposalId ? await read(ref('proposals', a.proposalId)) : null;
    if (p?.status === 'pending') { await settle(p.id); p = await read(ref('proposals', p.id)); }
    return result(a, p);
  }
  async function optIn(input) {
    const user = account(), now = clock();
    validId(input.requestId, 'request');
    requireThat(input.requestId.length >= 8, 'invalid-argument', 'Use a unique request ID.');
    requireThat(Array.isArray(input.activities) && input.activities.length > 0 && input.activities.length <= 3 && new Set(input.activities).size === input.activities.length && input.activities.every(a => POLICY.activities.includes(a)), 'invalid-argument', 'Choose coffee, food, or hang out.');
    requireThat(Number.isInteger(input.minutes) && input.minutes >= 15 && input.minutes <= 120, 'invalid-argument', 'Choose 15 to 120 minutes.');
    requireThat(Number.isInteger(input.maxWalkMinutes) && input.maxWalkMinutes >= 1 && input.maxWalkMinutes <= 20, 'invalid-argument', 'Choose a walking limit from 1 to 20 minutes.');
    const campus = await read(root);
    requireThat(campus?.enabled === true, 'failed-precondition', 'Pulse is not open on this campus yet.');
    const spots = (await f.getDocs(f.collection(root, 'spots'))).docs.map(data).filter(usableSpot);
    let location;
    if (input.startingSpotId) {
      const spot = spots.find(s => s.id === input.startingSpotId);
      requireThat(spot, 'failed-precondition', 'Choose an available starting spot.');
      location = { ...point(spot), accuracy: 0 };
    } else location = validateFix(input.position, now);
    requireThat(withinBounds(location, campus.bounds), 'failed-precondition', 'Choose a starting point on this campus.');
    const walks = Object.fromEntries(spots.map(s => [s.id, walkingMinutes({ location }, s)]).filter(([, minutes]) => minutes <= input.maxWalkMinutes));
    requireThat(spots.some(s => Object.hasOwn(walks, s.id) && s.activities.some(activity => input.activities.includes(activity))),
      'failed-precondition', 'No spots for your selected activity fit that walk. Choose another starting place or a longer walking limit.');
    await refresh();
    return f.runTransaction(db, async tx => {
      const previous = data(await tx.get(ref('availability', user.uid)));
      const p = previous?.proposalId ? data(await tx.get(ref('proposals', previous.proposalId))) : null;
      const current = result(previous, p);
      if (previous?.requestId === input.requestId) {
        requireThat(current.status === 'waiting' || current.status === 'proposed', 'failed-precondition', 'That availability session has finished. Start again.');
        return current;
      }
      requireThat(!['proposed', 'confirmed'].includes(current.status), 'failed-precondition', 'Finish your current proposal or meetup first.');
      tx.set(ref('availability', user.uid), {
        uid: user.uid, displayName: String(user.displayName || user.name || 'Student').slice(0, 40), requestId: input.requestId,
        version: crypto.randomUUID(), activities: input.activities, walks, status: 'waiting', proposalId: null,
        createdAt: server(), updatedAt: server(), expiresAt: stamp(now + input.minutes * MINUTE),
      });
      return { status: 'waiting' };
    });
  }
  async function match() {
    const uid = account().uid, state = await refresh();
    if (state.status !== 'waiting') return state;
    const own = await read(ref('availability', uid));
    const [poolSnapshot, spotsSnapshot] = await Promise.all([
      f.getDocs(f.query(f.collection(root, 'availability'), f.where('status', '==', 'waiting'), f.limit(POLICY.matchingPoolLimit))),
      f.getDocs(f.collection(root, 'spots')),
    ]);
    const pool = poolSnapshot.docs.map(data).filter(a => a.uid !== uid && millis(a.expiresAt) > clock()).sort((a,b) => millis(a.createdAt) - millis(b.createdAt) || a.uid.localeCompare(b.uid));
    let choice;
    for (const activity of own.activities) for (const spot of spotsSnapshot.docs.map(data).filter(usableSpot)) {
      const people = [own];
      for (const candidate of pool) if (people.length < 4 && plan([...people, candidate], spot, activity, clock())) people.push(candidate);
      const timing = plan(people, spot, activity, clock());
      if (timing && (!choice || people.length > choice.people.length)) choice = { people, spot, activity };
    }
    if (!choice) return state;
    const id = crypto.randomUUID();
    try {
      await f.runTransaction(db, async tx => {
        const people = [];
        for (const person of choice.people) people.push(data(await tx.get(ref('availability', person.uid))));
        const spot = data(await tx.get(ref('spots', choice.spot.id)));
        if (!people.every(a => a?.status === 'waiting' && a.proposalId === null)) return;
        const now = clock(), timing = plan(people, spot, choice.activity, now);
        if (!timing) return;
        tx.set(ref('proposals', id), {
          candidateIds: people.map(a => a.uid), participantNames: Object.fromEntries(people.map(a => [a.uid, a.displayName])),
          availabilityVersions: Object.fromEntries(people.map(a => [a.uid, a.version])), activity: choice.activity,
          spotId: spot.id, spot: { name: spot.name, instruction: spot.instruction, ...point(spot) },
          walkingMinutes: timing.walks, walkingEstimate: true, minimumAcceptances: 2,
          startsAt: stamp(timing.startsAt), endsAt: stamp(timing.endsAt), chatClosesAt: stamp(timing.endsAt + POLICY.chatGraceMs),
          responseDeadline: stamp(now + POLICY.responseWindowMs), deleteAfter: stamp(timing.endsAt + POLICY.retentionMs),
          status: 'pending', responses: {}, participantIds: [], departedIds: [], createdAt: server(), updatedAt: server(),
        });
        for (const a of people) tx.update(ref('availability', a.uid), { status: 'reserved', proposalId: id, updatedAt: server() });
      });
    } catch (error) {
      // A competing match can reserve a ticket and revoke its public read mid-transaction.
      if (!['permission-denied', 'aborted'].includes(error.code)) throw error;
      const latest = await refresh();
      if (latest.status !== 'waiting') return latest;
      // Retry on the next matching tick; never weaken permissions to handle a race.
      return latest;
    }
    return refresh();
  }
  async function respond(input) {
    const uid = account().uid, id = validId(input.proposalId, 'proposal');
    requireThat(['accept', 'decline'].includes(input.decision), 'invalid-argument', 'Accept or pass on this plan.');
    await f.runTransaction(db, async tx => {
      const p = data(await tx.get(ref('proposals', id)));
      requireThat(p?.candidateIds.includes(uid), 'permission-denied', 'This plan was not addressed to you.');
      if (p.status !== 'pending' || clock() >= millis(p.responseDeadline)) return;
      if (p.responses[uid]?.decision === input.decision) return;
      requireThat(p.responses[uid]?.decision !== 'decline', 'failed-precondition', 'You already passed on this plan.');
      tx.update(ref('proposals', id), new f.FieldPath('responses', uid), { decision: input.decision, respondedAt: server() }, 'updatedAt', server());
    });
    await settle(id); return refresh();
  }
  async function cancel() {
    const uid = account().uid, state = await refresh();
    requireThat(state.status !== 'confirmed', 'failed-precondition', 'Leave your confirmed meetup instead.');
    if (state.proposalId) await respond({ proposalId: state.proposalId, decision: 'decline' });
    await f.runTransaction(db, async tx => {
      const a = data(await tx.get(ref('availability', uid)));
      if (a) tx.update(ref('availability', uid), { status: 'closed', updatedAt: server() });
    });
    return { status: 'idle' };
  }
  async function leave(input) {
    const uid = account().uid, id = validId(input.meetupId, 'meetup');
    await f.runTransaction(db, async tx => {
      const p = data(await tx.get(ref('proposals', id)));
      requireThat(p?.participantIds.includes(uid), 'permission-denied', 'You are not in this meetup.');
      if (p.departedIds.includes(uid)) return;
      tx.update(ref('proposals', id), { departedIds: [...p.departedIds, uid], updatedAt: server() });
    });
    return refresh();
  }
  async function checkIn(input) {
    const uid = account().uid, id = validId(input.meetupId, 'meetup');
    requireThat(['manual', 'automatic'].includes(input.method), 'invalid-argument', 'Choose a check-in method.');
    return f.runTransaction(db, async tx => {
      const p = data(await tx.get(ref('proposals', id))), arrival = ref('proposals', id);
      requireThat(p?.status === 'confirmed' && active(p).length >= 2 && active(p).includes(uid) && millis(p.endsAt) > clock(), 'failed-precondition', 'This meetup is no longer active.');
      const checkRef = f.doc(arrival, 'checkIns', uid), existing = data(await tx.get(checkRef));
      if (existing) return { status: 'checked-in', method: existing.method };
      if (input.method === 'automatic') validateAutomaticArrival(input.fixes, p.spot, clock(), millis(p.confirmedAt));
      tx.set(checkRef, { uid, method: input.method, checkedInAt: server() });
      return { status: 'checked-in', method: input.method };
    });
  }
  const operations = { optIn, match, respond, refresh: () => refresh(), cancel, leave, checkIn };
  return { root, ref, result, active, read,
    action: async (name, input = {}) => { account(); requireThat(Object.hasOwn(operations, name), 'invalid-argument', 'Unknown Pulse action.'); return operations[name](input); },
    // refresh's optional UID is internal; don't accept an action payload as an identity.
    refresh: () => refresh(),
  };
}
