import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this test through the Firestore emulator.');
const projectId = 'demo-fiu-chat';
const apps = [];
function client(name, uid) {
    const app = initializeApp({ projectId, apiKey: 'emulator-only' }, name);
    apps.push(app);
    const db = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185,
        uid ? { mockUserToken: { sub: uid, name } } : {});
    return { app, db, messages: sdk.collection(db, 'chats/Campus Chat/messages') };
}
const alice = client('Alice', 'alice');
const bob = client('Bob', 'bob');
const stranger = client('Stranger');

// Run the actual browser service against real SDK calls on the emulator.
const code = (await fs.readFile(new URL('../chatService.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from "\.\.\/firebase.js";\s*/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from "https:[^"]+";\s*/, '')
    .replaceAll('export ', '');
const createService = new Function('app', 'sdk',
    'const { getFirestore, collection, addDoc, serverTimestamp, query, orderBy, limitToLast, onSnapshot, getDocsFromServer, getDocFromServer, writeBatch, doc } = sdk;\n' +
    code + '\nreturn { watchMessages, sendMessage, clearMessages };');
const service = createService(alice.app, sdk);
const aliceUser = { uid: 'alice', displayName: 'Alice' };
const bobUser = { uid: 'bob', displayName: 'Bob' };
const message = user => ({ senderId: user.uid, name: user.displayName, text: 'Hello', createdAt: sdk.serverTimestamp() });

async function rejects(operation) {
    await assert.rejects(operation, error => error.code === 'permission-denied');
}
async function observe(db, predicate) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { stop(); reject(Error('Realtime update timed out')); }, 15000);
        const stop = sdk.onSnapshot(sdk.collection(db, 'chats/Campus Chat/messages'), snapshot => {
            if (!snapshot.metadata.fromCache && predicate(snapshot)) { clearTimeout(timeout); stop(); resolve(snapshot); }
        }, error => { clearTimeout(timeout); reject(error); });
    });
}

try {
    const roleResponse = await fetch('http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents/users/alice/roles/moderator', { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { enabled: { booleanValue: true } } }) });
    assert.ok(roleResponse.ok);
    await rejects(sdk.getDocs(stranger.messages));
    await rejects(sdk.addDoc(stranger.messages, message(aliceUser)));
    await rejects(sdk.addDoc(alice.messages, { ...message(aliceUser), senderId: 'bob' }));
    await rejects(sdk.addDoc(alice.messages, { ...message(aliceUser), text: '   ' }));
    await rejects(sdk.addDoc(alice.messages, { ...message(aliceUser), text: 'a'.repeat(2001) }));
    await rejects(sdk.addDoc(alice.messages, { ...message(aliceUser), createdAt: sdk.Timestamp.fromMillis(1) }));
    await rejects(sdk.addDoc(alice.messages, { ...message(aliceUser), extra: true }));
    const seenByBob = observe(bob.db, snapshot => snapshot.size === 1);
    const first = await service.sendMessage(aliceUser, 'Hello from Alice');
    const received = await seenByBob;
    assert.equal(received.docs[0].data().senderId, 'alice');
    assert.ok(received.docs[0].data().createdAt.toMillis() > 0);
    await rejects(sdk.updateDoc(first, { text: 'edited' }));
    await rejects(sdk.deleteDoc(sdk.doc(stranger.db, first.path)));
    await sdk.addDoc(bob.messages, message(bobUser));
    const seenByAlice = await new Promise((resolve, reject) => {
        const stop = service.watchMessages((messages, cached) => {
            if (!cached && messages.length === 2) { stop(); resolve(messages); }
        }, reject);
    });
    assert.ok(seenByAlice.some(message => message.name === 'Bob'));
    // More than 500 documents verifies Clear handles multiple batches.
    for (let offset = 0; offset < 501; offset += 10) {
        const batch = sdk.writeBatch(alice.db);
        for (let i = offset; i < Math.min(offset + 10, 501); i++) batch.set(sdk.doc(alice.messages), message(aliceUser));
        await batch.commit();
    }
    const latest = await new Promise((resolve, reject) => {
        const stop = service.watchMessages((messages, cached) => {
            if (!cached && messages.length === 100) { stop(); resolve(messages); }
        }, reject);
    });
    assert.equal(latest.length, 100);
    let newMessage;
    const count = await service.clearMessages(aliceUser, 'Test cleanup', (done) => {
        // Emulate another participant posting after the deletion snapshot.
        if (done === 4) newMessage = sdk.addDoc(bob.messages, { ...message(bobUser), text: 'New after Clear started' });
    });
    await newMessage;
    assert.equal(count, 503);
    const remaining = await sdk.getDocsFromServer(bob.messages);
    assert.equal(remaining.size, 1);
    assert.equal(remaining.docs[0].data().text, 'New after Clear started');
    const emptyOnBob = observe(bob.db, snapshot => snapshot.empty);
    assert.equal(await service.clearMessages(aliceUser, 'Test cleanup'), 1);
    await emptyOnBob;
    assert.equal(await service.clearMessages(aliceUser, 'Test cleanup'), 0);
    await service.sendMessage(aliceUser, 'Fresh start');
    assert.equal((await sdk.getDocsFromServer(bob.messages)).size, 1);
    await service.clearMessages(aliceUser, 'Test cleanup');
    console.log('PASS: two-user realtime chat; stored identity/time/text; rules reject unsigned/spoofed/invalid writes; latest 100; full 503-message clear; concurrent new message survives; empty clear; fresh send.');
} finally {
    await Promise.all(apps.map(deleteApp));
}
