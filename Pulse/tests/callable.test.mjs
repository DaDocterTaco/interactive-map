import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { seed, optInInput } from './fixtures.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8197'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9107') throw Error('Use only the local Pulse Firestore and Auth emulators.');
const projectId = 'demo-campus-pulse';
test('callable API authenticates three independent anonymous sessions end to end', async () => {
  const admin = initializeAdmin({ projectId }), db = getFirestore(admin), apps = [];
  try {
    await seed(db, 'api-test');
    const clients = [];
    for (let index = 0; index < 4; index++) {
      const app = initializeApp({ projectId, apiKey: 'emulator-only' }, `callable-${index}`); apps.push(app);
      const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9107', { disableWarnings: true });
      const functions = getFunctions(app, 'us-central1'); connectFunctionsEmulator(functions, '127.0.0.1', 5017);
      const invoke = httpsCallable(functions, 'pulseAction');
      clients.push({ auth, invoke: async (action, input = {}) => (await invoke({ campusId: 'api-test', action, input })).data });
    }
    await assert.rejects(clients[3].invoke('optIn', optInInput('anonymous')), e => e.code === 'functions/unauthenticated');
    for (const [index, client] of clients.slice(0, 3).entries()) {
      await signInAnonymously(client.auth);
      await client.invoke('optIn', { ...optInInput(`api-${index}`), uid: 'forged-other-person' });
    }
    const proposals = await Promise.all(clients.slice(0, 3).map(c => c.invoke('match')));
    const proposalId = proposals[0].proposalId;
    assert.ok(proposalId); assert.ok(proposals.every(p => p.proposalId === proposalId));
    await Promise.all(clients.slice(0, 3).map(c => c.invoke('respond', { proposalId, decision: 'accept' })));
    const meetup = (await db.doc(`pulse/api-test/meetups/${proposalId}`).get()).data();
    assert.deepEqual(meetup.participantIds.slice().sort(), clients.slice(0, 3).map(c => c.auth.currentUser.uid).sort());
    assert.equal(meetup.participantIds.includes('forged-other-person'), false);
    for (const client of clients.slice(0, 3)) assert.equal((await client.invoke('refresh')).meetupId, proposalId);
  } finally {
    await Promise.all(apps.map(deleteApp)); await db.terminate(); await deleteAdmin(admin);
  }
});
