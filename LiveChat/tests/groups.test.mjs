// Emulator integration for group creation, membership, access requests,
// password proofs, activity deadlines, and Firestore rule enforcement.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { makeSalt, passwordVerifier } from '../groupPassword.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use the local emulator only.');
sdk.setLogLevel('silent');
const apps = [];
const groupCode = (await fs.readFile(new URL('../groups.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const chatCode = (await fs.readFile(new URL('../chatService.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const sdkBindings = `const { ${Object.keys(sdk).join(', ')} } = sdk;\n`;
const groupFactory = new Function('app', 'sdk', 'makeSalt', 'passwordVerifier', sdkBindings + groupCode + '\nreturn { createGroup, joinGroup, isMember, requestAccess, decideRequest, changeIdleHours, setPinned, watchRequests, watchMyRequest, watchMembership, isClosed, expiresAt };');
const chatFactory = new Function('app', 'sdk', sdkBindings + chatCode + '\nreturn { sendMessage, watchMessages };');
function client(uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid);
    apps.push(app);
    const db = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, { mockUserToken: { sub: uid } });
    return { db, user: { uid, displayName: uid }, groups: groupFactory(app, sdk, makeSalt, passwordVerifier), chat: chatFactory(app, sdk) };
}
const alice = client('owner'), bob = client('joiner'), carol = client('requester'), dave = client('outsider');
const ref = (client, path) => sdk.doc(client.db, path);
const denied = async action => assert.rejects(action, error => error.code === 'permission-denied');
const once = (subscribe, predicate) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(Error('Listener timed out')); }, 15000);
    const stop = subscribe(data => { if (predicate(data)) { clearTimeout(timeout); stop(); resolve(data); } }, error => { clearTimeout(timeout); reject(error); });
});
async function setActivity(id, millis) {
    const response = await fetch(`http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents/chats/${id}?updateMask.fieldPaths=lastActivityAt`, {
        method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { lastActivityAt: { timestampValue: new Date(millis).toISOString() } } })
    });
    assert.ok(response.ok, await response.text());
}
try {
    const publicGroup = await alice.groups.createGroup(alice.user, { name: 'Public test', visibility: 'public', idleHours: 12 });
    const privateGroup = await alice.groups.createGroup(alice.user, { name: 'Private test', visibility: 'private', idleHours: 12, password: 'correct password' });
    assert.equal(publicGroup.idleHours, 12);
    assert.equal(publicGroup.id, 'Public test');
    assert.equal(privateGroup.id, 'Private test');
    await assert.rejects(bob.groups.createGroup(bob.user, { name: 'Public test', visibility: 'public', idleHours: 12 }), /already taken/);
    await assert.rejects(alice.groups.createGroup(alice.user, { name: 'Campus Chat', visibility: 'public', idleHours: 12 }), /reserved/);
    await assert.rejects(alice.groups.createGroup(alice.user, { name: 'bad/name', visibility: 'public', idleHours: 12 }), /slashes/);
    const metadata = (await sdk.getDoc(ref(alice, `chats/${publicGroup.id}`))).data();
    await denied(sdk.setDoc(ref(bob, 'chats/Some other name'), { ...metadata, creatorId: bob.user.uid, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp() }));
    await denied(sdk.setDoc(ref(bob, 'chats/Campus Chat'), { ...metadata, name: 'Campus Chat', creatorId: bob.user.uid, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp() }));
    await denied(sdk.getDocs(sdk.collection(bob.db, 'chatGroups')));
    await denied(sdk.getDocs(sdk.collection(bob.db, 'chatGroupSecrets')));
    await denied(sdk.getDocs(sdk.collection(bob.db, `chats/${privateGroup.id}/private`)));
    assert.ok(await alice.groups.isMember(privateGroup.id, alice.user.uid));
    assert.equal((await sdk.getDocs(sdk.query(sdk.collection(bob.db, 'chats'), sdk.where('visibility', 'in', ['public', 'private'])))).size, 2);
    await denied(sdk.getDoc(ref(bob, `chats/${privateGroup.id}/private/password`)));
    await denied(sdk.getDoc(ref(alice, `chats/${privateGroup.id}/private/password`)));
    await denied(sdk.getDoc(ref(bob, `chats/${privateGroup.id}/members/owner`)));
    await denied(sdk.getDocs(sdk.collection(bob.db, `chats/${privateGroup.id}/messages`)));
    const observedMemberships = [];
    const stopWatchingWrongPassword = bob.groups.watchMembership(privateGroup.id, bob.user.uid, value => observedMemberships.push(value), error => { throw error; });
    await denied(bob.groups.joinGroup(privateGroup, bob.user, 'wrong password'));
    stopWatchingWrongPassword();
    assert.equal(observedMemberships.includes(true), false, 'A rejected optimistic membership must not open private chat');
    assert.equal(await bob.groups.isMember(privateGroup.id, bob.user.uid), false);
    await bob.groups.joinGroup(privateGroup, bob.user, 'correct password');
    const directory = await sdk.getDocs(sdk.collection(bob.db, `chats/${privateGroup.id}/people`));
    assert.equal(directory.size, 2);
    assert.ok(directory.docs.every(doc => Object.keys(doc.data()).join() === 'uid'));
    await denied(sdk.getDocs(sdk.collection(dave.db, `chats/${privateGroup.id}/people`)));
    await denied(sdk.getDocs(sdk.collection(bob.db, `chats/${privateGroup.id}/members`)));
    await bob.groups.joinGroup(publicGroup, bob.user);
    const seen = once((cb, err) => bob.chat.watchMessages((messages, cached) => { if (!cached) cb(messages); }, err, privateGroup.id), messages => messages.length === 1);
    await alice.chat.sendMessage(alice.user, 'Private hello', privateGroup.id);
    assert.equal((await seen)[0].name, 'owner');
    await denied(dave.chat.sendMessage(dave.user, 'Intruder', privateGroup.id));
    await denied(sdk.updateDoc(ref(bob, `chats/${privateGroup.id}`), { lastActivityAt: sdk.serverTimestamp() }));
    await denied(bob.groups.changeIdleHours(privateGroup.id, 72));
    await alice.groups.changeIdleHours(privateGroup.id, 72);
    assert.equal((await sdk.getDoc(ref(alice, `chats/${privateGroup.id}`))).data().idleHours, 72);
    await assert.rejects(alice.groups.changeIdleHours(privateGroup.id, 73));
    await denied(sdk.updateDoc(ref(alice, `chats/${privateGroup.id}`), { idleHours: 73 }));
    await alice.groups.setPinned(alice.user.uid, privateGroup.id, true);
    assert.ok((await sdk.getDoc(ref(alice, `chatPreferences/owner/pins/${privateGroup.id}`))).exists());
    await denied(sdk.getDocs(sdk.collection(bob.db, 'chatPreferences/owner/pins')));
    await alice.groups.setPinned(alice.user.uid, privateGroup.id, false);

    const requestsSeen = once((cb, err) => alice.groups.watchRequests(privateGroup.id, cb, err), list => list.length === 1);
    await carol.groups.requestAccess(privateGroup, carol.user);
    await carol.groups.requestAccess(privateGroup, carol.user); // Duplicate is a no-op.
    assert.equal((await requestsSeen)[0].name, 'requester');
    await denied(dave.groups.decideRequest(privateGroup.id, carol.user.uid, dave.user, true));
    await denied(carol.groups.decideRequest(privateGroup.id, carol.user.uid, carol.user, true));
    await bob.groups.decideRequest(privateGroup.id, carol.user.uid, bob.user, false);
    assert.equal(await carol.groups.isMember(privateGroup.id, carol.user.uid), false);
    assert.equal((await sdk.getDoc(ref(carol, `chats/${privateGroup.id}/requests/requester`))).data().status, 'denied');
    await carol.groups.requestAccess(privateGroup, carol.user);
    const approved = once((cb, err) => carol.groups.watchMembership(privateGroup.id, carol.user.uid, cb, err), Boolean);
    await bob.groups.decideRequest(privateGroup.id, carol.user.uid, bob.user, true);
    await approved;
    await carol.chat.sendMessage(carol.user, 'Approved without password', privateGroup.id);
    await assert.rejects(alice.groups.decideRequest(privateGroup.id, carol.user.uid, alice.user, false), /already been handled/);
    // A request cannot grant membership unless the member also records a decision atomically.
    await denied(sdk.setDoc(ref(alice, `chats/${privateGroup.id}/members/outsider`), { joinedAt: sdk.serverTimestamp(), proof: '' }));
    await dave.groups.requestAccess(privateGroup, dave.user);
    await dave.groups.joinGroup(privateGroup, dave.user, 'correct password');
    assert.equal((await sdk.getDoc(ref(dave, `chats/${privateGroup.id}/requests/outsider`))).exists(), false);

    await setActivity(publicGroup.id, Date.now() - 11 * 3600000);
    await bob.chat.sendMessage(bob.user, 'Reset activity', publicGroup.id);
    const reset = (await sdk.getDoc(ref(bob, `chats/${publicGroup.id}`))).data();
    assert.ok(reset.lastActivityAt.toMillis() > Date.now() - 10000);
    await setActivity(publicGroup.id, Date.now() - 13 * 3600000);
    await denied(bob.chat.sendMessage(bob.user, 'Too late', publicGroup.id));
    await denied(sdk.getDocs(sdk.collection(bob.db, `chats/${publicGroup.id}/messages`)));
    await denied(carol.groups.joinGroup(publicGroup, carol.user));
    await denied(alice.groups.changeIdleHours(publicGroup.id, 72));
    await setActivity(privateGroup.id, Date.now() - 73 * 3600000);
    await denied(alice.chat.sendMessage(alice.user, 'Expired private', privateGroup.id));
    console.log('PASS: public/private groups; private secrecy; correct/wrong passwords; member messages; owner-only 12–72h limits; private pins; request/deny/retry/accept; approval by another member; no self-approval; password dismisses request; atomic activity reset; expired groups block reads, writes, joining and revival.');
} finally { await Promise.all(apps.map(deleteApp)); }
