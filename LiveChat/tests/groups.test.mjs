// Emulator integration for group creation, membership, access requests,
// password proofs, permanent group lifetimes, owner deletion, and rules.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { makeSalt, passwordVerifier } from '../groupPassword.js';
import { validateAppearance } from '../groupAppearance.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use the local emulator only.');
sdk.setLogLevel('silent');
const apps = [];
const groupCode = (await fs.readFile(new URL('../groups.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const chatCode = (await fs.readFile(new URL('../chatService.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const sdkBindings = `const { ${Object.keys(sdk).join(', ')} } = sdk;\n`;
const makeGroupFactory = new Function('app', 'sdk', 'makeSalt', 'passwordVerifier', 'validateAppearance', sdkBindings + groupCode + '\nreturn { createGroup, joinGroup, isMember, requestAccess, decideRequest, deleteGroup, setPinned, watchGroups, watchRequests, watchMyRequest, watchMembership, isClosed };');
const groupFactory = (app, sdk, salt, proof) => makeGroupFactory(app, sdk, salt, proof, validateAppearance);
const chatFactory = new Function('app', 'sdk', sdkBindings + chatCode + '\nreturn { sendMessage, watchMessages };');
function client(uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid);
    apps.push(app);
    const db = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, { mockUserToken: { sub: uid } });
    return { app, db, user: { uid, displayName: uid }, groups: groupFactory(app, sdk, makeSalt, passwordVerifier), chat: chatFactory(app, sdk) };
}
const alice = client('owner'), bob = client('joiner'), carol = client('requester'), dave = client('outsider');
const mod = client('group-moderator'), eve = client('late-requester');
const ref = (client, path) => sdk.doc(client.db, path);
const denied = async action => assert.rejects(action, error => error.code === 'permission-denied');
const once = (subscribe, predicate) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(Error('Listener timed out')); }, 15000);
    const stop = subscribe(data => { if (predicate(data)) { clearTimeout(timeout); stop(); resolve(data); } }, error => { clearTimeout(timeout); reject(error); });
});
async function seed(path, fields, merge = false) {
    const mask = merge ? '?' + Object.keys(fields).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&') : '';
    const response = await fetch(`http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents/${path}${mask}`, {
        method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    assert.ok(response.ok, await response.text());
}
const deletion = uid => ({ deletedAt: sdk.serverTimestamp(), deletedBy: uid });
try {
    let snapshotListener, snapshotOptions, watchedGroups;
    const mockWatcher = groupFactory(alice.app, { ...sdk, onSnapshot(query, options, listener) {
        snapshotOptions = options; snapshotListener = listener; return () => {};
    } }, makeSalt, passwordVerifier);
    mockWatcher.watchGroups(value => { watchedGroups = value; }, error => { throw error; });
    assert.equal(snapshotOptions.includeMetadataChanges, true, 'server acknowledgment must trigger a second snapshot');
    const pendingDeletion = { name: 'Pending deletion', visibility: 'public', deletedBy: 'owner', deletedAt: sdk.Timestamp.now() };
    const snapshot = (pending, committed = false) => ({ docs: [{ id: 'Pending deletion', metadata: { hasPendingWrites: pending },
        data: options => ({ ...pendingDeletion, deletedAt: pending && !committed && options?.serverTimestamps === 'none' ? null : pendingDeletion.deletedAt }) }] });
    snapshotListener(snapshot(true));
    assert.equal(mockWatcher.isClosed(watchedGroups[0]), false, 'optimistic tombstones must not close the UI');
    assert.equal(Object.hasOwn(watchedGroups[0], 'deletedBy'), false);
    snapshotListener(snapshot(false));
    assert.equal(mockWatcher.isClosed(watchedGroups[0]), true, 'only acknowledged tombstones close the UI');
    snapshotListener(snapshot(true, true));
    assert.equal(mockWatcher.isClosed(watchedGroups[0]), true, 'an unrelated pending write cannot hide a committed deletion');
    // Extra arguments from an older caller are ignored; all new records omit
    // idleHours and all clients may keep using their old saved memberships.
    const publicGroup = await alice.groups.createGroup(alice.user, { name: 'Public test', visibility: 'public', idleHours: 12 });
    const privateGroup = await alice.groups.createGroup(alice.user, { name: 'Private test', visibility: 'private', password: 'correct password' });
    assert.equal(Object.hasOwn(publicGroup, 'idleHours'), false);
    assert.equal(Object.hasOwn(privateGroup, 'idleHours'), false);
    assert.equal(publicGroup.id, 'Public test');
    assert.equal(privateGroup.id, 'Private test');
    await assert.rejects(bob.groups.createGroup(bob.user, { name: 'Public test', visibility: 'public', idleHours: 12 }), /already taken/);
    await assert.rejects(alice.groups.createGroup(alice.user, { name: 'Campus Chat', visibility: 'public', idleHours: 12 }), /reserved/);
    await assert.rejects(alice.groups.createGroup(alice.user, { name: 'bad/name', visibility: 'public', idleHours: 12 }), /slashes/);
    const metadata = (await sdk.getDoc(ref(alice, `chats/${publicGroup.id}`))).data();
    assert.deepEqual(Object.keys(metadata).sort(), ['name', 'visibility', 'salt', 'creatorId', 'createdAt', 'lastActivityAt', 'lastMessageId'].sort());
    await denied(sdk.setDoc(ref(alice, 'chats/Rejected legacy creation'), { ...metadata, name: 'Rejected legacy creation', idleHours: 12, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp() }));
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
    await denied(sdk.updateDoc(ref(bob, `chats/${privateGroup.id}`), { idleHours: 72 }));
    await denied(sdk.updateDoc(ref(alice, `chats/${privateGroup.id}`), { idleHours: 72 }));
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

    await seed('users/group-moderator/roles/moderator', { enabled: { booleanValue: true } });
    for (const [group, oldHours] of [[publicGroup, 12], [privateGroup, 72]]) {
        await seed(`chats/${encodeURIComponent(group.id)}`, {
            idleHours: { integerValue: String(oldHours) },
            lastActivityAt: { timestampValue: new Date(Date.now() - 365 * 86400000).toISOString() }
        }, true);
        const legacy = { id: group.id, ...(await sdk.getDocFromServer(ref(alice, `chats/${group.id}`))).data() };
        assert.equal(legacy.idleHours, oldHours);
        assert.equal(alice.groups.isClosed(legacy), false, 'legacy inactivity limits must not close a group');
        await sdk.getDocsFromServer(sdk.collection(bob.db, `chats/${group.id}/messages`));
        await mod.groups.joinGroup(legacy, mod.user, 'correct password');
        await mod.chat.sendMessage(mod.user, 'Still open after a year', group.id);
        assert.ok((await sdk.getDocFromServer(ref(alice, `chats/${group.id}`))).data().lastActivityAt.toMillis() > Date.now() - 10000);
        // Metadata activity is still recorded for sorting, but has no deadline.
        await denied(sdk.updateDoc(ref(alice, `chats/${group.id}`), { idleHours: 24 }));
        for (const actor of [bob, carol, dave, mod, eve]) {
            await assert.rejects(actor.groups.deleteGroup(group.id, actor.user), /Only the group creator/);
            await denied(sdk.updateDoc(ref(actor, `chats/${group.id}`), deletion(actor.user.uid)));
        }
        for (const mutation of [
            { deletedAt: sdk.serverTimestamp() }, { deletedBy: 'owner' },
            { deletedAt: sdk.Timestamp.fromMillis(1), deletedBy: 'owner' },
            { deletedAt: sdk.serverTimestamp(), deletedBy: 'joiner' },
            { ...deletion('owner'), creatorId: 'joiner' },
            { ...deletion('owner'), name: 'Changed' },
            { creatorId: 'joiner' }, { visibility: 'public', extra: true }
        ]) await denied(sdk.updateDoc(ref(alice, `chats/${group.id}`), mutation));
        await denied(sdk.deleteDoc(ref(alice, `chats/${group.id}`)));
    }
    await carol.groups.joinGroup(publicGroup, carol.user);
    await eve.groups.requestAccess(privateGroup, eve.user);

    // Reserved and direct conversations can never be deleted through group
    // APIs or a forged owner-like update, even when a creator field exists.
    await seed('chats/Campus%20Chat', { name: { stringValue: 'Campus Chat' }, visibility: { stringValue: 'public' }, creatorId: { stringValue: 'owner' } });
    await seed('chats/dm:owner:joiner', { visibility: { stringValue: 'direct' }, name: { stringValue: 'Direct message' },
        participantIds: { arrayValue: { values: [{ stringValue: 'owner' }, { stringValue: 'joiner' }] } }, creatorId: { stringValue: 'owner' } });
    for (const id of ['Campus Chat', 'dm:owner:joiner']) {
        await assert.rejects(alice.groups.deleteGroup(id, alice.user), /Only group chats/);
        await denied(sdk.updateDoc(ref(alice, `chats/${id}`), deletion('owner')));
        await denied(sdk.deleteDoc(ref(alice, `chats/${id}`)));
    }
    await assert.rejects(alice.groups.deleteGroup('Missing group', alice.user), /no longer exists/);

    for (const group of [publicGroup, privateGroup]) {
        const before = (await sdk.getDocFromServer(ref(alice, `chats/${group.id}`))).data();
        const deletionSeen = once((cb, err) => bob.groups.watchGroups(cb, err), list => list.some(item => item.id === group.id && bob.groups.isClosed(item)));
        await alice.groups.deleteGroup(group.id, alice.user); await deletionSeen;
        const tombstone = (await sdk.getDocFromServer(ref(alice, `chats/${group.id}`))).data();
        assert.equal(tombstone.deletedBy, 'owner'); assert.ok(tombstone.deletedAt.toMillis() > Date.now() - 10000);
        assert.equal(tombstone.lastActivityAt.toMillis(), before.lastActivityAt.toMillis());
        assert.equal(tombstone.creatorId, 'owner'); assert.equal(tombstone.name, group.id);
        assert.equal(alice.groups.isClosed(tombstone), true);
        // Metadata stays discoverable to deliver tombstones and reserve names;
        // every retained member-only child document is now inaccessible.
        for (const actor of [alice, bob, mod]) {
            await denied(sdk.getDocsFromServer(sdk.collection(actor.db, `chats/${group.id}/messages`)));
            await denied(sdk.getDocsFromServer(sdk.collection(actor.db, `chats/${group.id}/people`)));
            await denied(sdk.getDocFromServer(ref(actor, `chats/${group.id}/members/${actor.user.uid}`)));
            await denied(actor.chat.sendMessage(actor.user, 'Cannot revive', group.id));
            await denied(actor.groups.joinGroup(group, actor.user, 'correct password'));
        }
        await assert.rejects(alice.groups.deleteGroup(group.id, alice.user), /already deleted/);
        await assert.rejects(bob.groups.joinGroup({ id: group.id, ...tombstone }, bob.user, 'correct password'), /deleted/);
        const forgedJoin = sdk.writeBatch(eve.db);
        forgedJoin.set(ref(eve, `chats/${group.id}/members/${eve.user.uid}`), {
            joinedAt: sdk.serverTimestamp(), proof: group.visibility === 'private'
                ? await passwordVerifier('correct password', group.salt) : ''
        });
        forgedJoin.set(ref(eve, `chats/${group.id}/people/${eve.user.uid}`), { uid: eve.user.uid });
        await denied(forgedJoin.commit());
        for (const mutation of [
            { deletedAt: sdk.deleteField(), deletedBy: sdk.deleteField() },
            { deletedAt: null }, { deletedBy: 'joiner' }, { creatorId: 'joiner' },
            { lastActivityAt: sdk.serverTimestamp(), lastMessageId: 'revive' }
        ]) await denied(sdk.updateDoc(ref(alice, `chats/${group.id}`), mutation));
        await denied(sdk.deleteDoc(ref(alice, `chats/${group.id}`)));
        await assert.rejects(alice.groups.createGroup(alice.user, { name: group.id, visibility: 'public' }), /already taken/);
        await denied(sdk.setDoc(ref(alice, `chats/${group.id}`), { ...metadata, name: group.id, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp() }));
    }
    await denied(eve.groups.requestAccess(privateGroup, eve.user));
    await denied(sdk.setDoc(ref(dave, `chats/${privateGroup.id}/requests/${dave.user.uid}`), {
        userId: dave.user.uid, name: dave.user.displayName, status: 'pending',
        createdAt: sdk.serverTimestamp(), decidedAt: null, decidedBy: ''
    }));
    await denied(sdk.getDocFromServer(ref(eve, `chats/${privateGroup.id}/requests/${eve.user.uid}`)));
    await denied(sdk.deleteDoc(ref(eve, `chats/${privateGroup.id}/requests/${eve.user.uid}`)));
    await denied(alice.groups.decideRequest(privateGroup.id, eve.user.uid, alice.user, true));
    await denied(bob.groups.decideRequest(privateGroup.id, eve.user.uid, bob.user, false));
    await denied(sdk.updateDoc(ref(alice, `chats/${privateGroup.id}/requests/${eve.user.uid}`), {
        status: 'denied', decidedAt: sdk.serverTimestamp(), decidedBy: alice.user.uid
    }));
    await denied(sdk.getDocsFromServer(sdk.query(sdk.collection(alice.db, `chats/${privateGroup.id}/requests`), sdk.where('status', '==', 'pending'))));
    console.log('PASS: persistent public/private groups; no new idleHours schema; year-old 12h/72h records remain readable/joinable/sendable; password secrecy and membership; request flows; owner-only tombstones; moderator/nonowner/reserved/DM deletion denial; deleted child access denied; no restore or name reuse.');
} finally { await Promise.all(apps.map(deleteApp)); }
