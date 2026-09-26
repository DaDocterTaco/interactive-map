// Emulator integration for discussion posts, replies, pagination, and rules.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Run through the Firestore emulator.');
const apps = [];
const source = (await fs.readFile(new URL('../forums/forumService.js', import.meta.url), 'utf8'))
    .replace(/^import.*?;\s*/, '').replace(/import\s*\{[\s\S]*?\}\s*from "https:[^"]+";\s*/, '').replaceAll('export ', '');
const factory = new Function('app', 'sdk', `const { getFirestore, collection, doc, onSnapshot, query, orderBy, limit, limitToLast, serverTimestamp, setDoc, writeBatch, increment, runTransaction, getDocFromServer } = sdk;\n${source}\nreturn { createPost, sendReply, watchPosts, watchPost, watchReplies };`);
function client(name, uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, name);
    apps.push(app);
    const db = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, uid ? { mockUserToken: { sub: uid, name } } : {});
    return { db, service: factory(app, sdk), user: { uid, displayName: name } };
}
const alice = client('Forum Alice', 'forum-alice'), bob = client('Forum Bob', 'forum-bob'), guest = client('Forum Guest');
const denied = operation => assert.rejects(operation, error => error.code === 'permission-denied');
const read = id => sdk.getDoc(sdk.doc(alice.db, 'forums', id));
function observed(subscribe, predicate) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stop(); reject(Error('Forum realtime update timed out')); }, 15000);
        const stop = subscribe((value, cached) => {
            if (!cached && predicate(value)) { clearTimeout(timer); stop(); resolve(value); }
        }, error => { clearTimeout(timer); reject(error); });
    });
}
try {
    await denied(sdk.getDocs(sdk.collection(guest.db, 'forums')));
    const feed = observed((success, error) => bob.service.watchPosts(50, success, error), posts => posts.some(p => p.title === 'Library question'));
    const id = await alice.service.createPost(alice.user, 'Library question', 'Where can I study?\nSomewhere quiet, please.', 'Question');
    const posts = await feed;
    assert.equal(posts.find(p => p.id === id).authorId, alice.user.uid);
    const second = await alice.service.createPost(alice.user, 'Library question', 'Same title, separate discussion.', 'Comment');
    assert.notEqual(second, id);
    const onBob = observed((success, error) => bob.service.watchReplies(id, 50, success, error), replies => replies.length === 1);
    const replyId = await alice.service.sendReply(alice.user, id, 'Also interested!\nThanks.');
    assert.equal((await onBob)[0].body, 'Also interested!\nThanks.');
    await Promise.all([
        alice.service.sendReply(alice.user, id, 'Alice reply'),
        bob.service.sendReply(bob.user, id, 'Bob reply')
    ]);
    assert.equal((await read(id)).data().replyCount, 3);
    assert.equal((await read(second)).data().replyCount, 0);
    const latest = await observed((success, error) => alice.service.watchReplies(id, 2, success, error), replies => replies.length === 2);
    assert.ok(latest.every(reply => reply.id !== replyId));
    const parent = sdk.doc(alice.db, 'forums', id);
    const original = (await read(id)).data();
    const post = { ...original, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp(), replyCount: 0, lastReplyId: '' };
    await denied(sdk.setDoc(sdk.doc(guest.db, 'forums', 'guest'), post));
    for (const override of [
        { authorId: bob.user.uid }, { title: ' ' }, { body: ' \n\t ' }, { title: 'x'.repeat(141) },
        { body: 'x'.repeat(5001) }, { category: 'invalid' }, { replyCount: 2 },
        { createdAt: sdk.Timestamp.fromMillis(1) }, { extra: true }
    ]) await denied(sdk.setDoc(sdk.doc(sdk.collection(alice.db, 'forums')), { ...post, ...override }));
    await denied(sdk.updateDoc(parent, { title: 'Changed by reader' }));
    await denied(sdk.updateDoc(parent, { replyCount: sdk.increment(1) }));
    await denied(sdk.deleteDoc(parent));
    await denied(sdk.deleteDoc(sdk.doc(alice.db, 'forums', id, 'replies', replyId)));
    await denied(sdk.updateDoc(sdk.doc(alice.db, 'forums', id, 'replies', replyId), { body: 'Changed' }));
    await denied(sdk.getDocs(sdk.collection(guest.db, 'forums', id, 'replies')));
    await denied(alice.service.sendReply(alice.user, 'missing-post', 'Orphan reply'));
    await denied(alice.service.sendReply(bob.user, id, 'Spoofed reply'));
    const bareReply = sdk.doc(sdk.collection(alice.db, 'forums', id, 'replies'));
    await denied(sdk.setDoc(bareReply, { authorId: alice.user.uid, name: 'Alice', body: 'Without count', createdAt: sdk.serverTimestamp() }));
    // A batch cannot attach multiple replies to a single count increment.
    const batch = sdk.writeBatch(alice.db);
    for (const key of ['one', 'two']) batch.set(sdk.doc(alice.db, 'forums', id, 'replies', key), { authorId: alice.user.uid, name: 'Alice', body: 'Extra', createdAt: sdk.serverTimestamp() });
    batch.update(parent, { replyCount: sdk.increment(1), lastReplyId: 'one', lastActivityAt: sdk.serverTimestamp() });
    await denied(batch.commit());
    await assert.rejects(alice.service.createPost(alice.user, ' ', 'Body', 'Question'));
    await assert.rejects(alice.service.sendReply(alice.user, id, 'x'.repeat(2001)));
    assert.equal((await read(id)).data().replyCount, 3);
    console.log('PASS: two-user live posts/replies, multiline text, duplicate titles, concurrent accurate counts, thread isolation, reply pagination, unsigned/spoofed/invalid writes denied, immutable posts/replies, orphan replies and forged counts blocked.');
} finally {
    await Promise.all(apps.map(deleteApp));
}
