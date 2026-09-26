import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use local emulator');
sdk.setLogLevel('silent');
const apps = [];
async function factory(file, exports) {
    const code = (await fs.readFile(new URL('../' + file, import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
    return new Function('app', 'sdk', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${code}\nreturn { ${exports} };`);
}
const peopleFactory = await factory('people.js', 'saveProfile, searchPeople, saveFriend, removeFriend, openDirect, watchDirects, watchFriends, watchMembers');
const chatFactory = await factory('chatService.js', 'sendMessage, watchMessages');
function client(uid, displayName = uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid || 'unsigned'); apps.push(app);
    const db = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, uid ? { mockUserToken: { sub: uid } } : {});
    return { db, user: { uid, displayName }, people: peopleFactory(app, sdk), chat: chatFactory(app, sdk) };
}
const a = client('dm-alice', 'Alice'), b = client('dm-bob', 'Bob'), c = client('dm-carol', 'Carol'), unsigned = client('');
const ref = (c, p) => sdk.doc(c.db, p);
const denied = op => assert.rejects(op, error => error.code === 'permission-denied');
const once = (subscribe, predicate) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(Error('Snapshot timed out')); }, 10000);
    const stop = subscribe(data => { if (predicate(data)) { clearTimeout(timeout); stop(); resolve(data); } }, error => { clearTimeout(timeout); reject(error); });
});
try {
    for (const person of [a, b, c]) await person.people.saveProfile(person.user);
    await a.people.saveProfile(a.user);
    const found = await a.people.searchPeople('bO', a.user.uid);
    assert.equal(found.length, 1); assert.equal(found[0].displayName, 'Bob');
    await denied(sdk.getDocs(sdk.collection(unsigned.db, 'users')));
    await denied(sdk.updateDoc(ref(b, 'users/dm-alice'), { displayName: 'Hacked' }));
    await denied(sdk.updateDoc(ref(a, 'users/dm-alice'), { secret: 'Do not put private fields in searchable profiles' }));
    const [first, reverse] = await Promise.all([a.people.openDirect(a.user, b.user), b.people.openDirect(b.user, a.user)]);
    assert.equal(first.id, reverse.id);
    const seenDirect = await once((cb, err) => b.people.watchDirects(b.user.uid, cb, err), list => list.some(chat => chat.id === first.id));
    assert.equal(seenDirect[0].visibility, 'direct');
    await denied(sdk.getDoc(ref(c, `chats/${first.id}`)));
    await denied(sdk.getDocs(sdk.collection(c.db, `chats/${first.id}/messages`)));
    await denied(sdk.getDocs(sdk.collection(a.db, 'chats'))); // No global DM directory.
    const seenMessage = once((cb, err) => b.chat.watchMessages((items, cache) => { if (!cache) cb(items); }, err, first.id), messages => messages.length === 1);
    await a.chat.sendMessage(a.user, 'A private message', first.id);
    assert.equal((await seenMessage)[0].senderId, a.user.uid);
    await b.chat.sendMessage(b.user, 'Reply', first.id);
    await denied(c.chat.sendMessage(c.user, 'Intrusion', first.id));
    await denied(sdk.updateDoc(ref(a, `chats/${first.id}`), { participantIds: [a.user.uid, c.user.uid] }));
    await denied(sdk.updateDoc(ref(a, `chats/${first.id}`), { lastActivityAt: sdk.serverTimestamp() }));
    await a.people.saveFriend(a.user, b.user); await a.people.saveFriend(a.user, b.user);
    const saved = (await sdk.getDoc(ref(a, 'users/dm-alice/friends/dm-bob'))).data();
    assert.equal(saved.chatId, first.id);
    await denied(sdk.getDocs(sdk.collection(b.db, 'users/dm-alice/friends')));
    await denied(sdk.setDoc(ref(b, 'users/dm-alice/friends/dm-carol'), { friendId: c.user.uid, chatId: first.id, savedAt: sdk.serverTimestamp() }));
    await a.people.removeFriend(a.user, b.user);
    assert.equal((await sdk.getDocs(sdk.collection(a.db, `chats/${first.id}/messages`))).size, 2);
    assert.equal((await a.people.openDirect(a.user, b.user)).id, first.id);
    await denied(sdk.getDocs(sdk.collection(a.db, 'chats/Campus Chat/people')));
    console.log('PASS: searchable profiles, own-profile writes, private saved friends, deterministic concurrent DMs, both-party realtime delivery, outsider denial, immutable participants, preserved messages after removing friend, no Campus member directory.');
} finally { await Promise.all(apps.map(deleteApp)); }
