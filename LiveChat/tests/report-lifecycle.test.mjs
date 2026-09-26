// Emulator checks for 24-hour expiry, resolution permissions, and historical
// reports. The service source is evaluated with the Node Firestore SDK below.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use local emulator');
sdk.setLogLevel('silent');
const source = (await fs.readFile(new URL('../forums/forumService.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const factory = new Function('app', 'sdk', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${source}\nreturn {createPost, resolveReport, approveReport, setConfirmation, sendReply};`);
const apps = [];
function client(uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid || 'guest'); apps.push(app);
    const db = sdk.getFirestore(app); sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, uid ? { mockUserToken: { sub: uid } } : {});
    return { db, user: { uid, displayName: uid }, service: factory(app, sdk) };
}
const author = client('author'), verifier = client('verifier'), reader = client('reader'), other = client('other'), guest = client('');
const ref = (who, id) => sdk.doc(who.db, 'forums', id);
const denied = op => assert.rejects(op, error => error.code === 'permission-denied');
const resolution = who => ({ status: 'resolved', resolvedBy: who.user.uid, resolvedName: who.user.displayName, resolvedAt: sdk.serverTimestamp(), note: '' });
const create = () => author.service.createPost(author.user, 'Report', 'Concern', 'Alert', { label: 'Library', latitude: 25.75, longitude: -80.37 });
async function patch(path, fields, mask = '') {
    const response = await fetch('http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents/' + path + mask, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    assert.ok(response.ok, await response.text());
}
try {
    await patch('users/verifier/roles/verifier', { enabled: { booleanValue: true } });
    const id = await create();
    await reader.service.setConfirmation(reader.user, id, true);
    await verifier.service.approveReport(verifier.user, id);
    await denied(sdk.updateDoc(ref(reader, id), { resolution: resolution(reader) }));
    await denied(sdk.updateDoc(ref(guest, id), { resolution: resolution(guest) }));
    await denied(sdk.updateDoc(ref(author, id), { resolution: { ...resolution(author), resolvedBy: 'someone-else' } }));
    await denied(sdk.updateDoc(ref(author, id), { resolution: { ...resolution(author), resolvedAt: sdk.Timestamp.fromMillis(0) } }));
    await denied(sdk.updateDoc(ref(author, id), { resolution: { ...resolution(author), note: 'x'.repeat(501) } }));
    await denied(sdk.updateDoc(ref(author, id), { resolution: resolution(author), confirmationCount: 99 }));
    await assert.rejects(reader.service.resolveReport(reader.user, id), /author or an authorized verifier/);
    await author.service.resolveReport(author.user, id, '  Walkway cleared  ');
    let data = (await sdk.getDoc(ref(author, id))).data();
    assert.equal(data.resolution.note, 'Walkway cleared'); assert.equal(data.resolution.resolvedBy, 'author'); assert.ok(data.resolution.resolvedAt.toMillis() > 0);
    assert.equal(data.confirmationCount, 1); assert.equal(data.verification.status, 'approved');
    await author.service.resolveReport(author.user, id, 'Duplicate');
    assert.equal((await sdk.getDoc(ref(author, id))).data().resolution.note, 'Walkway cleared');
    await denied(sdk.updateDoc(ref(author, id), { resolution: sdk.deleteField() }));
    await denied(sdk.updateDoc(ref(verifier, id), { resolution: resolution(verifier) }));
    await denied(other.service.setConfirmation(other.user, id, true));
    await denied(reader.service.setConfirmation(reader.user, id, false));
    await reader.service.sendReply(reader.user, id, 'History is still available.');
    const pending = await create();
    await verifier.service.resolveReport(verifier.user, pending);
    await denied(verifier.service.approveReport(verifier.user, pending));
    assert.equal((await sdk.getDoc(ref(reader, pending))).data().resolution.resolvedBy, 'verifier');
    const race = await create();
    await Promise.all([author.service.resolveReport(author.user, race, 'Author'), verifier.service.resolveReport(verifier.user, race, 'Verifier')]);
    assert.ok(['Author', 'Verifier'].includes((await sdk.getDoc(ref(reader, race))).data().resolution.note));
    const expired = await create();
    await reader.service.setConfirmation(reader.user, expired, true);
    await patch('forums/' + expired, { createdAt: { timestampValue: new Date(Date.now() - 86401000).toISOString() } }, '?updateMask.fieldPaths=createdAt');
    await denied(verifier.service.approveReport(verifier.user, expired));
    await denied(other.service.setConfirmation(other.user, expired, true));
    await denied(reader.service.setConfirmation(reader.user, expired, false));
    await denied(author.service.resolveReport(author.user, expired));
    await denied(sdk.updateDoc(ref(author, expired), { createdAt: sdk.serverTimestamp() }));
    await reader.service.sendReply(reader.user, expired, 'Reply to expired history.');
    data = (await sdk.getDoc(ref(reader, expired))).data(); assert.equal(data.replyCount, 1); assert.equal(data.verification, undefined);
    const normal = await author.service.createPost(author.user, 'Question', 'Description', 'Question');
    await denied(sdk.updateDoc(ref(verifier, normal), { resolution: resolution(verifier) }));
    const fresh = await create(); const base = (await sdk.getDoc(ref(author, fresh))).data();
    await denied(sdk.setDoc(sdk.doc(sdk.collection(author.db, 'forums')), { ...base, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp(), resolution: resolution(author) }));
    await patch('users/verifier/roles/verifier', { enabled: { booleanValue: false } });
    await denied(sdk.updateDoc(ref(verifier, fresh), { resolution: resolution(verifier) }));
    console.log('PASS: author/verifier resolution, optional note and timestamp, denied forged/unauthorized updates, immutable resolution, concurrent resolution, server-enforced 24-hour expiry, frozen confirmations and approvals, preserved discussion history.');
} finally { await Promise.all(apps.map(deleteApp)); }
