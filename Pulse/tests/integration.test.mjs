import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { PulseService } from '../backend/service.js';
import { POLICY, MINUTE } from '../shared/policy.js';
import { seed, optInInput, TEST_POSITION } from './fixtures.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8197') throw Error('Run this suite only in the local Pulse emulator on port 8197.');
const projectId = 'demo-campus-pulse';
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) throw Error('Refusing a real project.');
const admin = initializeAdmin({ projectId }), db = getFirestore(admin);
const root = db.doc('pulse/mmc'), apps = [];
let clock, service, serial = 0;
sdk.setLogLevel('silent');
const call = (uid, action, input = {}, campus = 'mmc') => service.action(uid ? { uid, name: uid.toUpperCase() } : null, campus, action, input);
const join = (uid, overrides) => call(uid, 'optIn', optInInput(uid, overrides));
const read = async path => (await db.doc(`pulse/mmc/${path}`).get()).data();
const deny = promise => assert.rejects(promise, e => e.code === 'permission-denied');
function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'emulator-only' }, `test-${++serial}`); apps.push(app);
  const database = sdk.getFirestore(app);
  sdk.connectFirestoreEmulator(database, '127.0.0.1', 8197, uid ? { mockUserToken: { sub: uid } } : {});
  return {
    db: database,
    ref: path => sdk.doc(database, `pulse/mmc/${path}`),
    get: path => sdk.getDocFromServer(sdk.doc(database, `pulse/mmc/${path}`)),
    messages: id => sdk.collection(database, `pulse/mmc/meetups/${id}/messages`),
    send: (id, text, sender = uid) => sdk.addDoc(sdk.collection(database, `pulse/mmc/meetups/${id}/messages`), { senderId: sender, text, createdAt: sdk.serverTimestamp() }),
  };
}
async function makeProposal(uids = ['a', 'b', 'c']) {
  await Promise.all(uids.map(uid => join(uid)));
  return (await call(uids[0], 'match')).proposalId;
}
async function confirm(uids = ['a', 'b', 'c']) {
  const id = await makeProposal(uids);
  await Promise.all(uids.map(uid => call(uid, 'respond', { proposalId: id, decision: 'accept' })));
  return id;
}
beforeEach(async () => {
  await Promise.all(apps.splice(0).map(deleteApp));
  const response = await fetch(`http://127.0.0.1:8197/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.ok, true);
  clock = Date.now(); service = new PulseService(db, { clock: () => clock }); await seed(db);
});
after(async () => { await Promise.all(apps.map(deleteApp)); await db.terminate(); await deleteAdmin(admin); });

test('three concurrent devices receive one proposal and confirm exactly one meetup/chat path', async () => {
  await Promise.all(['a', 'b', 'c'].map(uid => join(uid)));
  const attempts = await Promise.all(['a', 'b', 'c'].map(uid => call(uid, 'match')));
  const id = attempts[0].proposalId;
  assert.ok(id); assert.ok(attempts.every(r => r.proposalId === id));
  assert.equal((await root.collection('proposals').get()).size, 1);
  await Promise.all(['a', 'a', 'b', 'c'].map(uid => call(uid, 'respond', { proposalId: id, decision: 'accept' })));
  const meetup = await read(`meetups/${id}`);
  assert.deepEqual([...meetup.participantIds].sort(), ['a', 'b', 'c']);
  assert.equal((await root.collection('meetups').get()).size, 1);
  for (const uid of ['a', 'b', 'c']) {
    assert.equal((await call(uid, 'refresh')).meetupId, id);
    assert.equal(await read(`availability/${uid}`), undefined); // Private matching input removed.
  }
  assert.equal('location' in (await read(`proposals/${id}`)), false);
  await assert.rejects(join('a', { requestId: 'new-request-a' }), e => e.code === 'failed-precondition');
});

test('combined rules protect all Pulse data while preserving existing profile/chat access', async () => {
  await join('a'); const a = client('a'), b = client('b'), nobody = client('');
  assert.equal((await a.get('availability/a')).exists(), true);
  await deny(b.get('availability/a'));
  await deny(sdk.getDocs(sdk.collection(a.db, 'pulse/mmc/availability')));
  await deny(nobody.get('spots/test-spot'));
  for (const path of ['availability/a', 'memberState/a', 'proposals/fake', 'meetups/fake', 'spots/fake', 'unlisted/fake']) {
    await deny(sdk.setDoc(a.ref(path), { uid: 'a', status: 'confirmed' }));
  }
  await deny(sdk.setDoc(sdk.doc(a.db, 'pulse/new-campus'), { enabled: true }));
  await assert.rejects(call(null, 'optIn', optInInput('a')), e => e.code === 'unauthenticated');
  await sdk.setDoc(sdk.doc(a.db, 'users/a'), { uid: 'a', displayName: 'Alice', searchName: 'alice', createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() });
  await sdk.addDoc(sdk.collection(a.db, 'chats/Campus Chat/messages'), { senderId: 'a', name: 'Alice', text: 'Existing chat still works', createdAt: sdk.serverTimestamp() });
});

test('only accepted participants share messages; refresh restores state and forged writes fail', async () => {
  const id = await makeProposal();
  await call('a', 'respond', { proposalId: id, decision: 'accept' });
  await call('b', 'respond', { proposalId: id, decision: 'accept' });
  assert.equal(await read(`meetups/${id}`), undefined); // Give C time to respond.
  await call('c', 'respond', { proposalId: id, decision: 'decline' });
  const a = client('a'), b = client('b'), c = client('c'), outsider = client('outsider');
  assert.equal((await a.get('memberState/a')).data().meetupId, id);
  const delivered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(Error('Realtime delivery timed out')); }, 10_000);
    const stop = sdk.onSnapshot(b.messages(id), snapshot => {
      if (snapshot.size) { clearTimeout(timer); stop(); resolve(snapshot.docs[0].data()); }
    }, error => { clearTimeout(timer); reject(error); });
  });
  const message = await a.send(id, 'See you by the meeting point');
  assert.equal((await delivered).senderId, 'a');
  await deny(c.get(`meetups/${id}`)); await deny(outsider.get(`proposals/${id}`));
  await deny(sdk.getDocs(c.messages(id))); await deny(outsider.send(id, 'Intrude'));
  await deny(a.send(id, 'Forge', 'b')); await deny(a.send(id, '   '));
  await deny(sdk.updateDoc(message, { text: 'Changed' }));
  await deny(sdk.setDoc(a.ref(`meetups/${id}/checkIns/a`), { uid: 'a', method: 'manual', checkedInAt: sdk.serverTimestamp() }));
  await assert.rejects(call('outsider', 'respond', { proposalId: id, decision: 'accept' }), e => e.code === 'permission-denied');
});

test('deadline confirms two accepted people and never admits a late third person', async () => {
  const id = await makeProposal();
  for (const uid of ['a', 'b']) await call(uid, 'respond', { proposalId: id, decision: 'accept' });
  clock += POLICY.responseWindowMs + 1; await service.sweep('mmc');
  assert.deepEqual((await read(`meetups/${id}`)).participantIds.sort(), ['a', 'b']);
  await call('c', 'respond', { proposalId: id, decision: 'accept' });
  assert.equal((await call('c', 'refresh')).status, 'idle');
  assert.equal((await read(`meetups/${id}`)).participantIds.includes('c'), false);
});

test('too few responses expire cleanly; stale opt-ins never match', async () => {
  const id = await makeProposal(); await call('a', 'respond', { proposalId: id, decision: 'accept' });
  clock += POLICY.responseWindowMs + 1; await service.sweep('mmc');
  assert.equal((await read(`proposals/${id}`)).status, 'expired');
  assert.equal((await root.collection('availability').get()).size, 0);
  assert.equal((await root.collection('meetups').get()).size, 0);
  await join('a', { requestId: 'another-request-a', minutes: 15 });
  clock += 16 * MINUTE;
  await join('b', { requestId: 'another-request-b' });
  assert.equal((await call('b', 'match')).status, 'waiting');
  assert.equal((await call('a', 'refresh')).status, 'idle');
});

test('confirmation rechecks remaining time and spot validity', async () => {
  const id = await makeProposal(['a', 'b']);
  await call('a', 'respond', { proposalId: id, decision: 'accept' });
  await root.collection('spots').doc('test-spot').update({ enabled: false });
  await call('b', 'respond', { proposalId: id, decision: 'accept' });
  assert.equal((await read(`proposals/${id}`)).status, 'expired');
  assert.equal(await read(`meetups/${id}`), undefined);
  await root.collection('spots').doc('test-spot').update({ enabled: true });
  await join('a', { requestId: 'later-request-a' }); await join('b', { requestId: 'later-request-b' });
  const next = (await call('a', 'match')).proposalId;
  await call('a', 'respond', { proposalId: next, decision: 'accept' });
  clock += 40 * MINUTE;
  await call('b', 'respond', { proposalId: next, decision: 'accept' });
  assert.equal((await read(`proposals/${next}`)).status, 'expired');
});

test('manual and automatic arrival are repeat-safe and never store location trails', async () => {
  const id = await confirm(); const confirmedAt = clock; clock += 12_000;
  const fixes = [confirmedAt + 1_000, clock].map(capturedAt => ({ ...TEST_POSITION, accuracy: 5, capturedAt }));
  await assert.rejects(call('a', 'checkIn', { meetupId: id, method: 'automatic', fixes: fixes.map(f => ({ ...f, accuracy: 100 })) }), e => e.code === 'failed-precondition');
  await call('a', 'checkIn', { meetupId: id, method: 'automatic', fixes });
  await call('b', 'checkIn', { meetupId: id, method: 'manual' });
  await call('a', 'checkIn', { meetupId: id, method: 'manual' });
  const arrival = await read(`meetups/${id}/checkIns/a`);
  assert.deepEqual(Object.keys(arrival).sort(), ['checkedInAt', 'method', 'uid']);
  assert.equal(arrival.method, 'automatic');
  assert.equal((await root.collection('meetups').doc(id).collection('checkIns').get()).size, 2);
  await assert.rejects(call('outsider', 'checkIn', { meetupId: id, method: 'manual' }), e => e.code === 'permission-denied');
});

test('withdrawal before confirmation releases membership and cancels availability', async () => {
  const id = await makeProposal(); await call('a', 'respond', { proposalId: id, decision: 'accept' });
  await call('a', 'cancel');
  for (const uid of ['b', 'c']) await call(uid, 'respond', { proposalId: id, decision: 'accept' });
  assert.deepEqual((await read(`meetups/${id}`)).participantIds.sort(), ['b', 'c']);
  assert.equal(await read('availability/a'), undefined);
  assert.equal((await call('a', 'refresh')).status, 'idle');
});

test('leaving removes access and cancels a meetup when fewer than two remain', async () => {
  const id = await confirm(); const a = client('a');
  await call('a', 'checkIn', { meetupId: id, method: 'manual' });
  await call('a', 'leave', { meetupId: id });
  assert.equal((await read(`meetups/${id}`)).status, 'confirmed');
  await deny(a.send(id, 'I left')); await deny(a.get(`meetups/${id}`));
  assert.equal(await read(`meetups/${id}/checkIns/a`), undefined);
  await call('b', 'leave', { meetupId: id });
  assert.equal((await read(`meetups/${id}`)).status, 'canceled');
  assert.equal((await read('memberState/c')).reason, 'meetup-canceled');
  await join('d'); assert.equal((await call('d', 'match')).status, 'waiting');
});

test('scheduled end releases commitments, grace limits chat, retention removes nested records', async () => {
  const id = await confirm(['a', 'b']), a = client('a');
  await a.send(id, 'Meetup history'); await call('a', 'checkIn', { meetupId: id, method: 'manual' });
  const meetup = await read(`meetups/${id}`);
  clock = meetup.endsAt.toMillis() + 1; await service.sweep('mmc');
  assert.equal((await read(`meetups/${id}`)).status, 'ended');
  assert.equal((await call('a', 'refresh')).status, 'idle');
  // Rules use their own clock, independent of the service's simulated test clock.
  await root.collection('meetups').doc(id).update({ chatClosesAt: Timestamp.fromMillis(Date.now() - 1000) });
  await deny(a.send(id, 'After closing')); await deny(sdk.getDocs(a.messages(id)));
  clock = meetup.deleteAfter.toMillis() + 1; await service.sweep('mmc');
  assert.equal(await read(`meetups/${id}`), undefined);
  assert.equal((await root.collection('meetups').doc(id).collection('messages').get()).size, 0);
  assert.equal((await root.collection('meetups').doc(id).collection('checkIns').get()).size, 0);
  assert.equal(await read(`proposals/${id}`), undefined);
});

test('disabled catalog and invalid inputs cannot create invented or conflicting plans', async () => {
  await assert.rejects(join('a', { activities: ['invented'] }), e => e.code === 'invalid-argument');
  await assert.rejects(join('a', { minutes: 500 }), e => e.code === 'invalid-argument');
  await assert.rejects(join('a', { startingSpotId: 'unverified' }), e => e.code === 'failed-precondition');
  await join('a'); const original = (await read('availability/a')).expiresAt.toMillis(); clock += MINUTE;
  await join('a'); assert.equal((await read('availability/a')).expiresAt.toMillis(), original);
  await root.update({ enabled: false });
  await assert.rejects(join('b'), e => e.code === 'failed-precondition');
  await call('a', 'cancel'); assert.equal(await read('availability/a'), undefined);
});

test('retrying a completed opt-in cannot resurrect it or reuse historical meetup IDs', async () => {
  await join('a'); const firstVersion = (await read('availability/a')).version;
  await call('a', 'cancel');
  await assert.rejects(join('a'), e => e.code === 'failed-precondition');
  await join('a', { requestId: 'second-request-a' });
  assert.notEqual((await read('availability/a')).version, firstVersion);
  await call('a', 'cancel');
  // Even replaying an older request after a newer session gets a fresh internal
  // version, so a deterministic proposal ID can never overwrite an old chat.
  await join('a'); assert.notEqual((await read('availability/a')).version, firstVersion);
});
