import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { makeSalt, passwordVerifier } from '../groupPassword.js';
import { validateAppearance } from '../groupAppearance.js';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use the local emulator only.');
sdk.setLogLevel('silent');
const code = (await fs.readFile(new URL('../groups.js', import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
const factory = new Function('app', 'sdk', 'makeSalt', 'passwordVerifier', 'validateAppearance', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${code}\nreturn { createGroup, saveGroupAppearance, deleteGroup };`);
const apps = [];
function client(uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid); apps.push(app);
    const db = sdk.getFirestore(app); sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185, { mockUserToken: { sub: uid } });
    return { db, user: { uid, displayName: uid }, service: factory(app, sdk, makeSalt, passwordVerifier, validateAppearance) };
}
const owner = client('logo-owner'), other = client('logo-other');
const ref = (actor, id) => sdk.doc(actor.db, 'chats', id);
const denied = action => assert.rejects(action, error => error.code === 'permission-denied');
const icon = { kind: 'icon', color: 'violet', icon: 'book' };
const initials = { kind: 'initials', color: 'blue', text: 'SG' };
const image = { kind: 'image', color: 'slate', image: 'data:image/jpeg;base64,/9j/AA==' };
const malformed = [null, {}, { ...initials, extra: true }, { ...initials, text: '' }, { ...initials, text: 'FOUR' },
    { ...initials, text: 'a' }, { ...initials, color: '#000' }, { ...icon, icon: '../image.svg' },
    { ...image, image: 'https://example.com/logo.jpg' }, { ...image, image: 'data:image/svg+xml;base64,AAAA' },
    { ...image, image: 'data:image/jpeg;base64,bad' }, { ...image, image: image.image + 'A'.repeat(32768) }];
async function seed(id, fields) {
    const response = await fetch(`http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents/chats/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields })
    }); assert.ok(response.ok, await response.text());
}
try {
    const group = await owner.service.createGroup(owner.user, { name: 'Logo test', visibility: 'public', appearance: icon });
    assert.deepEqual(group.appearance, icon);
    const privateGroup = await owner.service.createGroup(owner.user, { name: 'Private logo', visibility: 'private', password: 'secret-password', appearance: initials });
    assert.deepEqual(privateGroup.appearance, initials);
    const old = await owner.service.createGroup(owner.user, { name: 'Legacy logo', visibility: 'public' });
    assert.equal(Object.hasOwn(old, 'appearance'), false);
    await owner.service.saveGroupAppearance(old.id, owner.user, initials);
    assert.deepEqual((await sdk.getDocFromServer(ref(owner, old.id))).data().appearance, initials);
    for (const appearance of [initials, icon, image]) {
        await owner.service.saveGroupAppearance(group.id, owner.user, appearance);
        assert.deepEqual((await sdk.getDocFromServer(ref(other, group.id))).data().appearance, appearance);
    }
    const before = (await sdk.getDocFromServer(ref(owner, group.id))).data();
    for (const appearance of malformed) {
        await assert.rejects(owner.service.saveGroupAppearance(group.id, owner.user, appearance));
        await denied(sdk.updateDoc(ref(owner, group.id), { appearance }));
        const name = 'Bad logo ' + malformed.indexOf(appearance);
        await denied(sdk.setDoc(ref(owner, name), { ...before, name, appearance, createdAt: sdk.serverTimestamp(), lastActivityAt: sdk.serverTimestamp() }));
    }
    await assert.rejects(other.service.saveGroupAppearance(group.id, other.user, initials), /Only the group owner/);
    await denied(sdk.updateDoc(ref(other, group.id), { appearance: initials }));
    await denied(other.service.saveGroupAppearance(group.id, owner.user, initials));
    for (const change of [{ name: 'Renamed' }, { creatorId: other.user.uid }, { lastActivityAt: sdk.serverTimestamp() }, { visibility: 'private' }]) {
        await denied(sdk.updateDoc(ref(owner, group.id), { appearance: initials, ...change }));
    }
    await denied(sdk.updateDoc(ref(owner, group.id), { appearance: sdk.deleteField() }));
    for (const id of ['Campus Chat', 'dm:logo-owner:logo-other']) {
        await seed(id, { name: { stringValue: id }, visibility: { stringValue: id === 'Campus Chat' ? 'public' : 'direct' }, creatorId: { stringValue: owner.user.uid }, participantIds: { arrayValue: { values: [{ stringValue: owner.user.uid }, { stringValue: other.user.uid }] } } });
        await assert.rejects(owner.service.saveGroupAppearance(id, owner.user, initials), /Only group chats/);
        await denied(sdk.updateDoc(ref(owner, id), { appearance: initials }));
    }
    await assert.rejects(owner.service.saveGroupAppearance('Missing logo', owner.user, initials), /no longer exists/);
    await assert.rejects(owner.service.saveGroupAppearance(group.id, null, initials), /Sign in/);
    await owner.service.deleteGroup(group.id, owner.user);
    assert.equal((await sdk.getDocFromServer(ref(owner, group.id))).data().deletedBy, owner.user.uid);
    await assert.rejects(owner.service.saveGroupAppearance(group.id, owner.user, icon), /deleted/);
    await denied(sdk.updateDoc(ref(owner, group.id), { appearance: icon }));
    await denied(sdk.updateDoc(ref(owner, group.id), { appearance: icon, deletedAt: sdk.deleteField(), deletedBy: sdk.deleteField() }));
    console.log('PASS: optional/legacy/public/private appearance; valid create/update; malformed/oversized/remote/SVG denial; owner-only metadata; impersonation/Campus/DM/deleted denial; deletion preserved.');
} finally { await Promise.all(apps.map(deleteApp)); }
