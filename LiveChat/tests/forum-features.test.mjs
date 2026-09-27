// Exercises the production service and deployed-rule source against an emulator.
// All accounts/content are synthetic and must never use the production database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Run through the Firestore emulator.');
const code = (await fs.readFile(new URL('../forums/forumService.js', import.meta.url), 'utf8'))
    .replace(/^import.*?;\s*/, '').replace(/import\s*\{[\s\S]*?\}\s*from "https:[^"]+";\s*/, '').replaceAll('export ', '');
const factory = new Function('app', 'sdk', `const { getFirestore, collection, doc, onSnapshot, query, orderBy, limit, limitToLast, serverTimestamp, setDoc, writeBatch, increment, runTransaction, getDocFromServer } = sdk;
${code}
return { createPost, sendReply, watchAllPosts, watchAllReplies, watchSavedPosts, setSavedPost, setAcceptedAnswer };`);
const apps = [];
function client(name, uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, name);
    apps.push(app);
    const db = sdk.getFirestore(app);
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    sdk.connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid, name } } : {});
    return { db, user: { uid, displayName: name }, service: factory(app, sdk) };
}
const alice = client('Feature Alice', 'feature-alice');
const alicePhone = client('Feature Alice Phone', 'feature-alice');
const bob = client('Feature Bob', 'feature-bob');
const guest = client('Feature Guest');
const denied = promise => assert.rejects(promise, error => error.code === 'permission-denied');
function observed(subscribe, predicate) {
    return new Promise((resolve, reject) => {
        let stop = () => {};
        const timer = setTimeout(() => { stop(); reject(Error('Forum snapshot timed out')); }, 15000);
        stop = subscribe((data, cached) => {
            if (!cached && predicate(data)) { clearTimeout(timer); stop(); resolve(data); }
        }, error => { clearTimeout(timer); stop(); reject(error); });
    });
}
const ref = (client, id) => sdk.doc(client.db, 'forums', id);
const get = async id => (await sdk.getDoc(ref(alice, id))).data();
const mirrored = (replyId, name, body, authorId) => ({ acceptedReplyId: replyId, acceptedAnswer: { replyId, name, body, authorId } });
try {
    const id = await alice.service.createPost(alice.user, 'Feature question', 'A question with a topic', 'Question', null, 'Study spaces');
    const parent = ref(alice, id);
    assert.equal((await get(id)).topic, 'Study spaces');
    const legacy = await alice.service.createPost(alice.user, 'Legacy discussion', 'No topic still supported', 'Comment');
    assert.equal((await get(legacy)).topic, undefined);
    for (const topic of ['Classes', 'Campus life', 'Parking & transit', 'Housing', 'Other']) {
        const topicPost = await alice.service.createPost(alice.user, topic, 'Topic test', 'Question', null, topic);
        assert.equal((await get(topicPost)).topic, topic);
    }
    await assert.rejects(alice.service.createPost(alice.user, 'Bad topic', 'Body', 'Question', null, 'Invalid'), /valid topic/);
    const raw = await get(id);
    await denied(sdk.setDoc(sdk.doc(sdk.collection(alice.db, 'forums')), { ...raw, topic: 'Invalid', createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp() }));
    const alert = await alice.service.createPost(alice.user, 'Topic does not leak into alert', 'Synthetic alert', 'Alert', { label: 'Library', latitude: 25.75, longitude: -80.37 }, 'Classes');
    assert.equal((await get(alert)).topic, undefined);
    await denied(sdk.setDoc(sdk.doc(sdk.collection(alice.db, 'forums')), { ...await get(alert), topic: 'Classes', createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp() }));
    await denied(sdk.updateDoc(parent, { topic: 'Housing' }));
    console.log('PASS: all six optional topics, legacy posts, invalid topic rejection, alert/topic separation.');

    const root = await bob.service.sendReply(bob.user, id, 'Try the Graham Center after 6.\nThere are outlets.');
    const nested = await alice.service.sendReply(alice.user, id, 'Thanks — I will try that!', root);
    const grandchild = await bob.service.sendReply(bob.user, id, 'You are welcome.', nested);
    const replies = await observed((cb, err) => bob.service.watchAllReplies(id, cb, err), data => data.length === 3);
    assert.equal(replies.find(reply => reply.id === nested).parentId, root);
    assert.equal(replies.find(reply => reply.id === grandchild).parentId, nested);
    assert.equal(replies.find(reply => reply.id === root).parentId, undefined);
    await denied(bob.service.sendReply(bob.user, id, 'Missing parent', 'missing'));
    const other = await alice.service.createPost(alice.user, 'Other question', 'Body', 'Question');
    await denied(alice.service.sendReply(alice.user, other, 'Wrong thread', root));
    await assert.rejects(alice.service.sendReply(alice.user, id, 'Bad parent', 'a/b'), /valid reply/);
    const self = sdk.doc(sdk.collection(alice.db, 'forums', id, 'replies'));
    const selfBatch = sdk.writeBatch(alice.db);
    selfBatch.set(self, { authorId: alice.user.uid, name: 'Alice', body: 'Self cycle', createdAt: sdk.serverTimestamp(), parentId: self.id });
    selfBatch.update(parent, { replyCount: sdk.increment(1), lastReplyId: self.id, lastActivityAt: sdk.serverTimestamp() });
    await denied(selfBatch.commit());
    assert.equal((await get(id)).replyCount, 3);
    console.log('PASS: multi-level replies, realtime tree parent IDs, cross-thread/missing/self parent denial and accurate counters.');

    const validRoot = mirrored(root, bob.user.displayName, 'Try the Graham Center after 6.\nThere are outlets.', bob.user.uid);
    await alice.service.setAcceptedAnswer(alice.user, id, root);
    assert.deepEqual((await get(id)).acceptedAnswer, validRoot.acceptedAnswer);
    const cards = await observed((cb, err) => alicePhone.service.watchAllPosts(cb, err), data => data.find(post => post.id === id)?.acceptedReplyId === root);
    assert.deepEqual(cards.find(post => post.id === id).acceptedAnswer, validRoot.acceptedAnswer);
    await assert.rejects(bob.service.setAcceptedAnswer(bob.user, id, nested), /Only the question author/);
    await denied(sdk.updateDoc(ref(bob, id), validRoot));
    for (const [field, value] of [['name', 'Someone else'], ['body', 'A forged answer'], ['authorId', alice.user.uid], ['replyId', nested]]) {
        await denied(sdk.updateDoc(parent, { ...validRoot, acceptedAnswer: { ...validRoot.acceptedAnswer, [field]: value } }));
    }
    await denied(sdk.updateDoc(parent, { ...validRoot, acceptedAnswer: { ...validRoot.acceptedAnswer, extra: true } }));
    await denied(sdk.updateDoc(parent, { acceptedReplyId: nested }));
    await denied(sdk.updateDoc(parent, { ...validRoot, title: 'Secret title change' }));
    await denied(sdk.updateDoc(ref(alice, other), validRoot));
    await denied(sdk.updateDoc(parent, mirrored('missing', 'Nobody', 'Missing', bob.user.uid)));
    const discussionReply = await bob.service.sendReply(bob.user, legacy, 'A reply to a comment');
    await assert.rejects(alice.service.setAcceptedAnswer(alice.user, legacy, discussionReply), /question is unavailable/);
    await denied(sdk.updateDoc(ref(alice, legacy), mirrored(discussionReply, bob.user.displayName, 'A reply to a comment', bob.user.uid)));
    await alice.service.setAcceptedAnswer(alice.user, id, nested);
    assert.equal((await get(id)).acceptedAnswer.body, 'Thanks — I will try that!');
    await denied(sdk.updateDoc(parent, { acceptedReplyId: '' }));
    await alice.service.setAcceptedAnswer(alice.user, id, '');
    assert.equal((await get(id)).acceptedReplyId, '');
    assert.equal((await get(id)).acceptedAnswer, null);
    await alicePhone.service.setAcceptedAnswer(alicePhone.user, id, root);
    console.log('PASS: author-only helpful reply selection, switch/clear, exact immutable preview mirror, cross-device feed updates; forged mirrors and cross-thread/non-question picks denied.');

    const savedPath = sdk.doc(alice.db, 'users', alice.user.uid, 'savedForums', id);
    const phoneSeesSave = observed((cb, err) => alicePhone.service.watchSavedPosts(alicePhone.user.uid, cb, err), ids => ids.includes(id));
    await alice.service.setSavedPost(alice.user, id, true);
    assert.ok((await phoneSeesSave).includes(id));
    await alice.service.setSavedPost(alice.user, id, true); // idempotent second tab
    assert.equal((await sdk.getDoc(savedPath)).data().postId, id);
    const desktopSeesRemoval = observed((cb, err) => alice.service.watchSavedPosts(alice.user.uid, cb, err), ids => !ids.includes(id));
    await alicePhone.service.setSavedPost(alicePhone.user, id, false);
    assert.deepEqual(await desktopSeesRemoval, []);
    await alice.service.setSavedPost(alice.user, id, true);
    const otherUserPath = sdk.doc(bob.db, 'users', alice.user.uid, 'savedForums', id);
    await denied(sdk.getDoc(otherUserPath));
    await denied(sdk.getDocs(sdk.collection(bob.db, 'users', alice.user.uid, 'savedForums')));
    await denied(sdk.setDoc(otherUserPath, { postId: id, savedAt: sdk.serverTimestamp() }));
    await denied(sdk.deleteDoc(otherUserPath));
    await denied(sdk.getDocs(sdk.collection(guest.db, 'users', alice.user.uid, 'savedForums')));
    await denied(alice.service.setSavedPost(alice.user, 'missing-post', true));
    await denied(sdk.setDoc(savedPath, { postId: other, savedAt: sdk.serverTimestamp() }));
    await denied(sdk.setDoc(savedPath, { postId: id, savedAt: sdk.Timestamp.fromMillis(1) }));
    await denied(sdk.setDoc(savedPath, { postId: id, savedAt: sdk.serverTimestamp(), enabled: true }));
    await denied(sdk.setDoc(sdk.doc(alice.db, 'users', alice.user.uid, 'roles', 'verifier'), { enabled: true }));
    await denied(sdk.setDoc(sdk.doc(alice.db, 'users', alice.user.uid, 'roles', 'moderator'), { enabled: true }));
    await bob.service.setSavedPost(bob.user, id, true);
    await alice.service.setSavedPost(alice.user, id, false);
    const bobSaved = await observed((cb, err) => bob.service.watchSavedPosts(bob.user.uid, cb, err), ids => ids.includes(id));
    assert.ok(bobSaved.includes(id));
    console.log('PASS: persistent account bookmarks synchronize across devices, idempotent save/removal, account isolation, missing posts/forged timestamps/extra fields and role escalation denied.');

    for (let index = 0; index < 51; index++) await alice.service.createPost(alice.user, `Archive ${index}`, 'Synthetic emulator-only post', 'Comment');
    const archive = await observed((cb, err) => alice.service.watchAllPosts(cb, err), data => data.length >= 60);
    assert.ok(archive.some(post => post.id === id), 'Oldest post must remain searchable after the old 50-post limit');
    assert.deepEqual(archive.find(post => post.id === id).acceptedAnswer, validRoot.acceptedAnswer);
    for (let index = 0; index < 48; index++) await bob.service.sendReply(bob.user, id, `Additional reply ${index}`);
    const fullReplies = await observed((cb, err) => alice.service.watchAllReplies(id, cb, err), data => data.length === 51);
    assert.ok(fullReplies.some(reply => reply.id === root), 'Root cannot disappear beyond 50 replies');
    assert.ok(fullReplies.some(reply => reply.id === nested));
    assert.equal((await get(id)).replyCount, 51);
    console.log('PASS: full post archive beyond 50 records and complete reply roots beyond 50 replies; helpful preview comes from a single feed snapshot.');
} finally {
    await Promise.all(apps.map(deleteApp));
}
