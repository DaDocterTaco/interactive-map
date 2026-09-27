import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp as adminApp, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { createFirestoreEngine } from '../client/firestore-engine.js';
import { seed, optInInput, TEST_POSITION } from './fixtures.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8197') throw Error('Local emulator required.');
const projectId = 'demo-campus-pulse';
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) throw Error('Refusing a real project.');
const admin = adminApp({ projectId }), database = getFirestore(admin), apps = [];
const root = database.doc('pulse/mmc');
let serial = 0;
sdk.setLogLevel('silent');
const deny = promise => assert.rejects(promise, e => e.code === 'permission-denied');
function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'emulator-only' }, 'spark-' + ++serial); apps.push(app);
  const db = sdk.getFirestore(app);
  sdk.connectFirestoreEmulator(db, '127.0.0.1', 8197, uid ? { mockUserToken: { sub: uid } } : {});
  const engine = createFirestoreEngine({ db, sdk, actor: () => uid ? { uid, displayName: uid.toUpperCase() } : null });
  return { ...engine, uid, db,
    join: (extra = {}) => engine.action('optIn', optInInput(uid, extra)),
    get: path => sdk.getDocFromServer(sdk.doc(db, 'pulse/mmc/' + path)),
    write: (path, value) => sdk.setDoc(sdk.doc(db, 'pulse/mmc/' + path), value),
    update: (path, value) => sdk.updateDoc(sdk.doc(db, 'pulse/mmc/' + path), value),
    send: (id, text, senderId = uid) => sdk.addDoc(sdk.collection(db, 'pulse/mmc/proposals/' + id + '/messages'), { text, senderId, createdAt: sdk.serverTimestamp() }),
  };
}
async function proposal(n = 3) {
  const people = ['a', 'b', 'c', 'd'].slice(0, n).map(client);
  await Promise.all(people.map(p => p.join()));
  const attempts = await Promise.all(people.map(p => p.action('match')));
  const id = attempts.find(r => r.proposalId)?.proposalId;
  assert.ok(id, 'A real SDK client must create a proposal through the deployed rules.');
  return { people, id };
}
async function confirm(n = 3) {
  const group = await proposal(n);
  await Promise.all(group.people.map(p => p.action('respond', { proposalId: group.id, decision: 'accept' })));
  return group;
}
beforeEach(async () => {
  await Promise.all(apps.splice(0).map(deleteApp));
  const response = await fetch('http://127.0.0.1:8197/emulator/v1/projects/demo-campus-pulse/databases/(default)/documents', { method: 'DELETE' });
  assert.equal(response.ok, true);
  await seed(database);
});
after(async () => { await Promise.all(apps.map(deleteApp)); await database.terminate(); await deleteAdmin(admin); });

test('three concurrent SDK clients reserve one group, confirm once, and restore after reload', async () => {
  const { people, id } = await confirm();
  assert.equal((await root.collection('proposals').get()).size, 1);
  const p = (await root.collection('proposals').doc(id).get()).data();
  assert.equal(p.status, 'confirmed');
  assert.deepEqual([...p.participantIds].sort(), ['a', 'b', 'c']);
  for (const person of people) {
    assert.equal((await person.action('refresh')).meetupId, id);
    await assert.rejects(person.join({ requestId: 'second-attempt-' + person.uid }), e => e.code === 'failed-precondition');
  }
  assert.equal((await client('a').action('refresh')).meetupId, id);
  const stored = JSON.stringify((await root.collection('availability').get()).docs.map(d => d.data()));
  assert.ok(!stored.includes('latitude') && !stored.includes('longitude') && !stored.includes('capturedAt'));
});

test('four-person atomic reservation stays within Firestore rules access limits', async () => {
  const { people, id } = await confirm(4);
  assert.equal((await people[0].get('proposals/' + id)).data().participantIds.length, 4);
});

test('responses, spots, locks, personal data and chat are protected from forged writes', async () => {
  const { people: [a, b, c], id } = await proposal();
  const outsider = client('outsider'), nobody = client('');
  await deny(outsider.get('proposals/' + id));
  await deny(nobody.get('spots/test-spot'));
  await deny(a.update('spots/test-spot', { enabled: false }));
  await deny(a.update('availability/b', { status: 'waiting', proposalId: null, updatedAt: sdk.serverTimestamp() }));
  await deny(a.update('proposals/' + id, { ['responses.b']: { decision: 'accept', respondedAt: sdk.serverTimestamp() }, updatedAt: sdk.serverTimestamp() }));
  await deny(a.update('proposals/' + id, { status: 'confirmed', participantIds: ['a','b','c'], confirmedAt: sdk.serverTimestamp(), resolvedAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));
  await deny(a.send(id, 'Too soon'));
  await a.action('respond', { proposalId: id, decision: 'accept' });
  await b.action('respond', { proposalId: id, decision: 'accept' });
  assert.equal((await a.get('proposals/' + id)).data().status, 'pending');
  await c.action('respond', { proposalId: id, decision: 'decline' });
  await deny(c.send(id, 'I did not accept'));
  await deny(a.send(id, 'Impersonation', 'b'));
  const delivered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(Error('Realtime message timeout')); }, 10000);
    const stop = sdk.onSnapshot(sdk.collection(b.db, 'pulse/mmc/proposals/' + id + '/messages'), snapshot => {
      if (snapshot.size) { clearTimeout(timer); stop(); resolve(snapshot.docs[0].data()); }
    }, reject);
  });
  await a.send(id, 'See you there');
  assert.equal((await delivered).text, 'See you there');
});

test('manual and automatic arrival are own-only, repeat-safe and never store GPS fixes', async () => {
  const { people: [a, b], id } = await confirm(2);
  await a.action('checkIn', { meetupId: id, method: 'manual' });
  assert.equal((await a.action('checkIn', { meetupId: id, method: 'automatic', fixes: [] })).method, 'manual');
  await deny(a.write('proposals/' + id + '/checkIns/b', { uid: 'b', method: 'manual', checkedInAt: sdk.serverTimestamp() }));
  await assert.rejects(b.action('checkIn', { meetupId: id, method: 'automatic', fixes: [] }));
  // Advance only the fixture's confirmation timestamp; the browser validates dwell/freshness.
  await root.collection('proposals').doc(id).update({ confirmedAt: Timestamp.fromMillis(Date.now() - 20000) });
  const now = Date.now(), fixes = [now - 11000, now].map(capturedAt => ({ ...TEST_POSITION, accuracy: 2, capturedAt }));
  await b.action('checkIn', { meetupId: id, method: 'automatic', fixes });
  const record = (await b.get('proposals/' + id + '/checkIns/b')).data();
  assert.deepEqual(Object.keys(record).sort(), ['checkedInAt', 'method', 'uid']);
});

test('withdrawal and leave revoke participation without letting anyone evict a peer', async () => {
  const { people: [a, b, c], id } = await proposal();
  await a.action('respond', { proposalId: id, decision: 'accept' });
  await a.action('cancel');
  await b.action('respond', { proposalId: id, decision: 'accept' });
  await c.action('respond', { proposalId: id, decision: 'accept' });
  await deny(a.send(id, 'Withdrawn'));
  await deny(b.update('proposals/' + id, { departedIds: ['c'], updatedAt: sdk.serverTimestamp() }));
  await b.action('leave', { meetupId: id });
  await deny(b.send(id, 'Left'));
  await deny(c.send(id, 'Only one remains'));
  assert.equal((await c.action('refresh')).status, 'idle');
  await c.join({ requestId: 'a-new-session-c' });
});

test('server deadlines reject late acceptance and permit two timely acceptances to settle', async () => {
  const { people: [a,b,c], id } = await proposal();
  await a.action('respond', { proposalId: id, decision: 'accept' });
  await b.action('respond', { proposalId: id, decision: 'accept' });
  await root.collection('proposals').doc(id).update({ responseDeadline: Timestamp.fromMillis(Date.now() - 1000) });
  await deny(c.update('proposals/' + id, { ['responses.c']: { decision: 'accept', respondedAt: sdk.serverTimestamp() }, updatedAt: sdk.serverTimestamp() }));
  await c.action('respond', { proposalId: id, decision: 'accept' });
  assert.deepEqual((await a.get('proposals/' + id)).data().participantIds.sort(), ['a','b']);
  await deny(c.send(id, 'Late'));
});

test('disabled spots invalidate offers; expired availability and chat are not usable', async () => {
  let { people: [a,b], id } = await proposal(2);
  await root.collection('spots').doc('test-spot').update({ enabled: false });
  await a.action('respond', { proposalId: id, decision: 'accept' });
  await b.action('respond', { proposalId: id, decision: 'accept' });
  assert.equal((await a.get('proposals/' + id)).data().status, 'expired');
  await assert.rejects(a.join({ requestId: 'retry-disabled-spot' }));
  await root.collection('spots').doc('test-spot').update({ enabled: true });
  await a.join({ requestId: 'fresh-session-aa' }); await b.join({ requestId: 'fresh-session-bb' });
  id = (await a.action('match')).proposalId;
  await a.action('respond', { proposalId: id, decision: 'accept' });
  await b.action('respond', { proposalId: id, decision: 'accept' });
  await root.collection('proposals').doc(id).update({ endsAt: Timestamp.fromMillis(Date.now() - 2000), chatClosesAt: Timestamp.fromMillis(Date.now() - 1000) });
  await deny(a.send(id, 'Expired'));
  await assert.rejects(a.action('checkIn', { meetupId: id, method: 'manual' }));
  assert.equal((await a.action('refresh')).status, 'idle');
});

test('combined rules preserve the existing profile and campus chat flows', async () => {
  const a = client('profile-test');
  await sdk.setDoc(sdk.doc(a.db, 'users/profile-test'), {
    uid: a.uid, displayName: 'Profile Test', searchName: 'profile test',
    createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
  });
  await sdk.addDoc(sdk.collection(a.db, 'chats/Campus Chat/messages'), {
    senderId: a.uid, name: 'Profile Test', text: 'Existing campus chat still works',
    createdAt: sdk.serverTimestamp(),
  });
});

test('overlapping five-device attempts cannot reserve a student twice or bypass acceptance', async () => {
  const people = ['a','b','c','d','e'].map(client);
  await Promise.all(people.map(p => p.join()));
  await Promise.all(people.map(p => p.action('match')));
  const plans = (await root.collection('proposals').get()).docs;
  assert.equal(plans.length, 1);
  const p = plans[0].data(), id = plans[0].id;
  assert.equal(p.candidateIds.length, 4);
  const first = people.find(person => person.uid === p.candidateIds[0]);
  await deny(first.update('proposals/' + id, { participantNames: {}, updatedAt: sdk.serverTimestamp() }));
  await assert.rejects(first.join({ requestId: 'another-session-during-offer' }));
  const other = people.find(person => !p.candidateIds.includes(person.uid));
  assert.equal((await other.action('refresh')).status, 'waiting');
  await deny(other.update('availability/' + other.uid, { latitude: 25, longitude: -80 }));
});

test('a reachable spot for the wrong activity does not strand the user in a waiting queue', async () => {
  await root.collection('spots').doc('test-spot').update({ activities: ['food'] });
  const a = client('a');
  await assert.rejects(a.join(), e => e.code === 'failed-precondition');
  assert.equal((await root.collection('availability').doc('a').get()).exists, false);
  await a.join({ activities: ['food'] });
  assert.equal((await a.action('refresh')).status, 'waiting');
});
