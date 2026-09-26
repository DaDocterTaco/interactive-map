// Emulator integration for alert location validation and per-user confirmations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use local emulator');
sdk.setLogLevel('silent');
const code = (await fs.readFile(new URL('../forums/forumService.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const factory = new Function('app', 'sdk', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${code}\nreturn { createPost, setConfirmation, watchConfirmation, sendReply };`);
const apps = [];
function client(uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid || 'alert-guest'); apps.push(app);
    const db = sdk.getFirestore(app); sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, uid ? { mockUserToken: { sub: uid } } : {});
    return { db, user: { uid, displayName: uid }, service: factory(app, sdk) };
}
const a = client('alert-author'), b = client('alert-bob'), c = client('alert-carol'), guest = client('');
const location = { label: 'Library entrance', latitude: 25.753960, longitude: -80.376620 };
const denied = op => assert.rejects(op, error => error.code === 'permission-denied');
const ref = (user, id) => sdk.doc(user.db, 'forums', id);
try {
    await assert.rejects(a.service.createPost(a.user, 'Concern', 'Description', 'Alert'), /location/);
    await assert.rejects(a.service.createPost(a.user, 'Concern', 'Description', 'Alert', { ...location, latitude: NaN }), /location/);
    const id = await a.service.createPost(a.user, 'Slippery walkway', 'Water on the walkway.\nUse caution.', 'Alert', location);
    let report = (await sdk.getDoc(ref(a, id))).data();
    assert.deepEqual(report.location, location); assert.equal(report.confirmationCount, 0);
    const received = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stop(); reject(Error('Confirmation timed out')); }, 10000);
        const stop = b.service.watchConfirmation(id, b.user.uid, (exists, pending) => { if (exists && !pending) { clearTimeout(timer); stop(); resolve(); } }, reject);
    });
    console.log('Checking concurrent different accounts');
    await Promise.all([b.service.setConfirmation(b.user, id, true), c.service.setConfirmation(c.user, id, true)]);
    await received;
    assert.equal((await sdk.getDoc(ref(a, id))).data().confirmationCount, 2);
    await Promise.all([b.service.setConfirmation(b.user, id, true), b.service.setConfirmation(b.user, id, true)]);
    assert.equal((await sdk.getDoc(ref(a, id))).data().confirmationCount, 2);
    await assert.rejects(a.service.setConfirmation(a.user, id, true), /own report/);
    await denied(sdk.updateDoc(ref(b, id), { confirmationCount: 99, lastConfirmationBy: b.user.uid }));
    await denied(sdk.updateDoc(ref(b, id), { location: { ...location, label: 'Changed place' } }));
    await denied(sdk.deleteDoc(sdk.doc(c.db, 'forums', id, 'confirmations', b.user.uid)));
    await denied(sdk.setDoc(sdk.doc(guest.db, 'forums', id, 'confirmations', 'guest'), { userId: 'guest', name: 'guest', createdAt: sdk.serverTimestamp() }));
    const own = sdk.writeBatch(a.db);
    own.set(sdk.doc(a.db, 'forums', id, 'confirmations', a.user.uid), { userId: a.user.uid, name: a.user.displayName, createdAt: sdk.serverTimestamp() });
    own.update(ref(a, id), { confirmationCount: 3, lastConfirmationBy: a.user.uid });
    await denied(own.commit());
    await b.service.setConfirmation(b.user, id, false); await b.service.setConfirmation(b.user, id, false);
    assert.equal((await sdk.getDoc(ref(a, id))).data().confirmationCount, 1);
    await b.service.setConfirmation(b.user, id, true);
    const duplicate = await a.service.createPost(a.user, 'Same account in two tabs', 'Duplicate-click check.', 'Alert', location);
    console.log('Checking concurrent duplicate confirmations');
    await Promise.all([b.service.setConfirmation(b.user, duplicate, true), b.service.setConfirmation(b.user, duplicate, true)]);
    assert.equal((await sdk.getDoc(ref(a, duplicate))).data().confirmationCount, 1);
    console.log('Checking concurrent duplicate withdrawals');
    await Promise.all([b.service.setConfirmation(b.user, duplicate, false), b.service.setConfirmation(b.user, duplicate, false)]);
    assert.equal((await sdk.getDoc(ref(a, duplicate))).data().confirmationCount, 0);
    await a.service.sendReply(a.user, id, 'An update from the reporter.');
    report = (await sdk.getDoc(ref(a, id))).data(); assert.equal(report.replyCount, 1); assert.equal(report.confirmationCount, 2);
    const ordinary = await a.service.createPost(a.user, 'Ordinary concern', 'A discussion without a location.', 'Concern');
    await assert.rejects(b.service.setConfirmation(b.user, ordinary, true), /unavailable/);
    const base = { ...report, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp(), replyCount: 0, lastReplyId: '', confirmationCount: 0, lastConfirmationBy: '' };
    for (const change of [{ location: null }, { location: { ...location, latitude: 91 } }, { location: { ...location, longitude: -181 } }, { location: { ...location, label: '  ' } }, { location: { ...location, extra: true } }, { confirmationCount: 1 }, { category: 'Question' }]) {
        await denied(sdk.setDoc(sdk.doc(sdk.collection(a.db, 'forums')), { ...base, ...change }));
    }
    console.log('PASS: alert location validation and preservation, live confirmations, simultaneous distinct users, duplicate prevention, self/unsigned/forged confirmations blocked, withdrawal/reconfirmation, immutable location, normal posts and alert replies.');
} finally { await Promise.all(apps.map(deleteApp)); }
