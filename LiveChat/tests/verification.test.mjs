// Emulator integration checks for verifier roles and immutable approvals.
// Source imports are replaced below so the browser service uses the Node SDK.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use local emulator');
sdk.setLogLevel('silent');
const source = (await fs.readFile(new URL('../forums/forumService.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const factory = new Function('app', 'sdk', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${source}\nreturn { createPost, setConfirmation, approveReport, watchVerifier, watchPost, sendReply };`);
const apps = [];
function client(uid, name = uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, name); apps.push(app);
    const db = sdk.getFirestore(app); sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, uid ? { mockUserToken: { sub: uid } } : {});
    return { db, user: { uid, displayName: name }, service: factory(app, sdk) };
}
const author = client('author'), reader = client('reader'), verifier = client('verifier'), second = client('second'), guest = client('', 'guest');
const twin = client('reader', 'Same account, other tab');
const doc = (who, id) => sdk.doc(who.db, 'forums', id);
const role = who => sdk.doc(who.db, 'users', who.user.uid, 'roles', 'verifier');
const location = { label: 'Library', latitude: 25.75, longitude: -80.37 };
const denied = op => assert.rejects(op, error => error.code === 'permission-denied');
const approval = who => ({ status: 'approved', verifierId: who.user.uid, verifierName: who.user.displayName, approvedAt: sdk.serverTimestamp() });
async function setRole(who, enabled) {
    const response = await fetch(`http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents/users/${who.user.uid}/roles/verifier`, {
        method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { enabled: { booleanValue: enabled } } })
    });
    assert.equal(response.ok, true, await response.text());
}
function once(subscribe, predicate) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stop(); reject(Error('Live update timed out')); }, 10000);
        const stop = subscribe(value => { if (predicate(value)) { clearTimeout(timer); stop(); resolve(value); } }, error => { clearTimeout(timer); reject(error); });
    });
}
try {
    const id = await author.service.createPost(author.user, 'Alert to review', 'Description', 'Alert', location);
    await Promise.all([reader.service.setConfirmation(reader.user, id, true), twin.service.setConfirmation(twin.user, id, true), second.service.setConfirmation(second.user, id, true)]);
    assert.equal((await sdk.getDoc(doc(reader, id))).data().confirmationCount, 2);
    await denied(sdk.setDoc(role(reader), { enabled: true }));
    await denied(sdk.setDoc(sdk.doc(reader.db, 'users', 'verifier', 'roles', 'verifier'), { enabled: true }));
    await denied(sdk.getDoc(sdk.doc(reader.db, 'users', 'verifier', 'roles', 'verifier')));
    await denied(sdk.setDoc(sdk.doc(reader.db, 'users', 'reader'), { uid: 'reader', displayName: 'reader', searchName: 'reader', createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), verifier: true }));
    await denied(sdk.updateDoc(doc(reader, id), { verification: approval(reader) }));
    await denied(sdk.updateDoc(doc(guest, id), { verification: approval(guest) }));
    await assert.rejects(reader.service.approveReport(reader.user, id), /authorized verifier/);
    const roleEnabled = once((cb, err) => verifier.service.watchVerifier(verifier.user.uid, cb, err), Boolean);
    await setRole(verifier, true); await roleEnabled; await setRole(second, true); await setRole(author, true);
    await denied(sdk.updateDoc(doc(author, id), { verification: approval(author) }));
    await assert.rejects(author.service.approveReport(author.user, id), /own report/);
    await denied(sdk.updateDoc(doc(verifier, id), { verification: { ...approval(verifier), verifierId: 'spoofed' } }));
    await denied(sdk.updateDoc(doc(verifier, id), { verification: { ...approval(verifier), approvedAt: sdk.Timestamp.fromMillis(1) } }));
    await denied(sdk.updateDoc(doc(verifier, id), { verification: approval(verifier), confirmationCount: 100 }));
    const forged = (await sdk.getDoc(doc(author, id))).data();
    await denied(sdk.setDoc(sdk.doc(sdk.collection(author.db, 'forums')), { ...forged, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp(), confirmationCount: 0, lastConfirmationBy: '', verification: approval(author) }));
    const approved = once((cb, err) => reader.service.watchPost(id, cb, err), data => !data.pending && data.verification?.status === 'approved');
    await Promise.all([verifier.service.approveReport(verifier.user, id), second.service.approveReport(second.user, id)]);
    const saved = (await approved).verification;
    assert.ok(['verifier', 'second'].includes(saved.verifierId)); assert.ok(saved.approvedAt.toMillis() > 0);
    await verifier.service.approveReport(verifier.user, id);
    assert.deepEqual((await sdk.getDoc(doc(reader, id))).data().verification, saved);
    await denied(sdk.updateDoc(doc(verifier, id), { verification: approval(verifier) }));
    await denied(sdk.updateDoc(doc(verifier, id), { verification: sdk.deleteField() }));
    await reader.service.setConfirmation(reader.user, id, false);
    await reader.service.sendReply(reader.user, id, 'Follow-up after approval.');
    const updated = (await sdk.getDoc(doc(reader, id))).data();
    assert.equal(updated.confirmationCount, 1); assert.equal(updated.replyCount, 1); assert.deepEqual(updated.verification, saved);
    const ordinary = await author.service.createPost(author.user, 'Normal post', 'Description', 'Question');
    await denied(sdk.updateDoc(doc(verifier, ordinary), { verification: approval(verifier) }));
    const other = await author.service.createPost(author.user, 'Another alert', 'Description', 'Alert', location);
    const revoked = once((cb, err) => verifier.service.watchVerifier(verifier.user.uid, cb, err), value => !value);
    await setRole(verifier, false); await revoked;
    await denied(sdk.updateDoc(doc(verifier, other), { verification: approval(verifier) }));
    await assert.rejects(verifier.service.approveReport(verifier.user, other), /authorized verifier/);
    console.log('PASS: distinct-account counts across tabs, administrator-only roles, live role/approval updates, unauthorized/self/forged approval blocked, concurrent immutable approval, replies and withdrawals after approval, role revocation.');
} finally { await Promise.all(apps.map(deleteApp)); }
