import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use the local emulator.');
sdk.setLogLevel('silent');
const code = (await fs.readFile(new URL('../chatService.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const factory = new Function('app', 'sdk', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${code}\nreturn {sendMessage, removeMessage, clearMessages, watchModerator};`);
const apps = [];
function client(uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid || 'guest'); apps.push(app);
    const db = sdk.getFirestore(app); sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, uid ? {mockUserToken:{sub:uid}} : {});
    return {db, user:{uid, displayName:uid}, service:factory(app, sdk)};
}
const alice = client('alice'), mod = client('mod'), verifier = client('verifier'), impersonator = client('fake'), guest = client('');
const denied = op => assert.rejects(op, error => error.code === 'permission-denied');
const messageRef = (who, id, chat = 'Campus Chat') => sdk.doc(who.db, 'chats', chat, 'messages', id);
const auditRef = (who, id, chat = 'Campus Chat') => sdk.doc(who.db, 'chats', chat, 'moderation', id);
const record = (who, id, extra = {}) => ({action:'remove', messageId:id, actorId:who.user.uid, createdAt:sdk.serverTimestamp(), reason:'Harmful message', ...extra});
const rawRemoval = (who, id, chat = 'Campus Chat', extra = {}) => {
    const batch = sdk.writeBatch(who.db);
    batch.set(auditRef(who, id, chat), record(who, id, extra)); batch.delete(messageRef(who, id, chat)); return batch.commit();
};
async function seed(path, fields) {
    const response = await fetch('http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents/' + path, {method:'PATCH', headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields})});
    assert.ok(response.ok, await response.text());
}
const role = (uid, name, enabled = true) => seed(`users/${uid}/roles/${name}`, {enabled:{booleanValue:enabled}});
const text = stringValue => ({stringValue});
const timestamp = () => ({timestampValue:new Date().toISOString()});
async function group(id, visibility, members) {
    await seed('chats/' + id, {name:text(id), visibility:text(visibility), creatorId:text('alice'), lastActivityAt:timestamp(), idleHours:{integerValue:'12'}});
    for (const uid of members) await seed(`chats/${id}/members/${uid}`, {joinedAt:timestamp(),proof:text('')});
}
try {
    await role('mod', 'moderator'); await role('verifier', 'verifier');
    const first = await alice.service.sendMessage(alice.user, 'Sample');
    for (const who of [alice, verifier, impersonator, guest]) {
        await denied(sdk.deleteDoc(messageRef(who, first.id)));
        await denied(rawRemoval(who, first.id));
    }
    // Neither a same-name profile, a role flag, nor another role grants moderation.
    await sdk.setDoc(sdk.doc(impersonator.db, 'users/fake'), {uid:'fake',displayName:'TheGambler101',searchName:'thegambler101',createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()});
    await denied(sdk.updateDoc(sdk.doc(impersonator.db,'users/fake'), {moderator:true}));
    for (const who of [alice, mod, verifier]) {
        await denied(sdk.setDoc(sdk.doc(who.db, 'users', who.user.uid, 'roles', 'moderator'), {enabled:true}));
        await denied(sdk.setDoc(sdk.doc(who.db, 'users', who.user.uid, 'roles', 'verifier'), {enabled:true}));
        await denied(sdk.getDoc(sdk.doc(who.db, 'users/fake/roles/moderator')));
        await denied(sdk.getDocs(sdk.collection(who.db, 'users', who.user.uid, 'roles')));
    }
    await assert.rejects(impersonator.service.clearMessages(impersonator.user, 'Attempt'), /Only a chat moderator/);
    await assert.rejects(verifier.service.removeMessage(verifier.user, first.id, 'Attempt'), /Only a chat moderator/);
    await denied(sdk.deleteDoc(messageRef(mod, first.id))); // Missing audit.
    await denied(sdk.setDoc(auditRef(mod, first.id), record(mod, first.id))); // Missing deletion.
    for (const extra of [{actorId:'alice'}, {createdAt:sdk.Timestamp.fromMillis(1)}, {reason:' '}, {reason:'x'.repeat(301)}, {extra:true}, {action:'unknown'}, {messageId:'other'}]) {
        await denied(rawRemoval(mod, first.id, 'Campus Chat', extra));
    }
    await mod.service.removeMessage(mod.user, first.id, '  Harmful content  ');
    assert.equal((await sdk.getDoc(messageRef(alice, first.id))).exists(), false);
    const log = (await sdk.getDoc(auditRef(mod, first.id))).data();
    assert.equal(log.actorId, 'mod'); assert.equal(log.reason, 'Harmful content'); assert.ok(log.createdAt.toMillis() > 0);
    await denied(sdk.getDoc(auditRef(alice, first.id)));
    await denied(sdk.updateDoc(auditRef(mod, first.id), {reason:'Cover tracks'}));
    await denied(sdk.deleteDoc(auditRef(mod, first.id)));
    await denied(sdk.setDoc(messageRef(alice, first.id), {senderId:'alice',name:'Alice',text:'Recreate',createdAt:sdk.serverTimestamp()}));
    // Public/private membership stays mandatory, including for moderators.
    for (const visibility of ['public','private']) {
        const id = 'group-' + visibility;
        await group(id, visibility, ['alice']);
        const msg = await alice.service.sendMessage(alice.user, 'Group sample', id);
        await denied(sdk.getDoc(messageRef(mod, msg.id, id)));
        await denied(rawRemoval(mod, msg.id, id));
        await denied(rawRemoval(alice, msg.id, id)); // Creator is not a moderator.
        await seed(`chats/${id}/members/mod`, {joinedAt:timestamp(),proof:text('')});
        await denied(rawRemoval(mod, msg.id, id, {action:'clear'}));
        await mod.service.removeMessage(mod.user, msg.id, 'Group concern', id);
        const another = await alice.service.sendMessage(alice.user, 'Old group', id);
        await seed('chats/' + id, {name:text(id),visibility:text(visibility),creatorId:text('alice'),lastActivityAt:{timestampValue:new Date(Date.now()-365*86400000).toISOString()},idleHours:{integerValue:'12'}});
        // The historical inactivity limit no longer closes or prevents
        // moderation in an otherwise accessible group.
        await mod.service.removeMessage(mod.user, another.id, 'Still active after a year', id);
        const retained = await alice.service.sendMessage(alice.user, 'Deleted group', id);
        await denied(sdk.updateDoc(sdk.doc(mod.db, 'chats', id), {deletedAt:sdk.serverTimestamp(),deletedBy:'mod'}));
        await sdk.updateDoc(sdk.doc(alice.db, 'chats', id), {deletedAt:sdk.serverTimestamp(),deletedBy:'alice'});
        await denied(rawRemoval(mod, retained.id, id));
        await denied(sdk.getDoc(auditRef(mod, another.id, id)));
    }
    await seed('chats/dm:alice:verifier', {name:text('Direct message'),visibility:text('direct'),participantIds:{arrayValue:{values:[text('alice'),text('verifier')]}},lastActivityAt:timestamp()});
    const dm = await alice.service.sendMessage(alice.user, 'Private', 'dm:alice:verifier');
    await denied(sdk.getDoc(messageRef(mod, dm.id, 'dm:alice:verifier')));
    await denied(rawRemoval(mod, dm.id, 'dm:alice:verifier'));
    await role('alice','moderator'); // Even participating moderators cannot remove DMs.
    await denied(rawRemoval(alice, dm.id, 'dm:alice:verifier'));
    await role('alice','moderator',false);
    // Bulk clear crosses several security-rule budgets and preserves later sends.
    for (let i=0;i<13;i++) await alice.service.sendMessage(alice.user, 'Bulk ' + i);
    let later;
    assert.equal(await mod.service.clearMessages(mod.user, 'Reset for demo', done => {
        if (done === 4) later = alice.service.sendMessage(alice.user, 'Arrived later');
    }),13);
    await later;
    assert.equal((await sdk.getDocsFromServer(sdk.collection(alice.db,'chats/Campus Chat/messages'))).size,1);
    assert.equal((await sdk.getDocsFromServer(sdk.collection(mod.db,'chats/Campus Chat/moderation'))).size,14);
    const remaining = await sdk.getDocsFromServer(sdk.collection(alice.db,'chats/Campus Chat/messages'));
    await role('mod','moderator',false);
    await denied(rawRemoval(mod,remaining.docs[0].id));
    await assert.rejects(mod.service.clearMessages(mod.user, 'Revoked'), /Only a chat moderator/);
    assert.equal((await sdk.getDoc(sdk.doc(mod.db,'users/mod/roles/verifier'))).exists(),false);
    console.log('PASS: regular/verifier/unsigned/impersonator blocked; protected roles; atomic immutable audits; forged removals denied; member-only moderation ignores old idle limits; moderators cannot delete another owner\'s group; deleted groups block moderation; private DMs; bulk clear; new arrivals preserved; revocation.');
} finally { await Promise.all(apps.map(deleteApp)); }
