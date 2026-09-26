// Emulator integration for the approved-report query and live map eligibility.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use local emulator');
sdk.setLogLevel('silent');
async function factory(file, exports) {
    const code = (await fs.readFile(new URL('../' + file, import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
    return new Function('app', 'sdk', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${code}\nreturn { ${exports} };`);
}
const forum = await factory('forums/forumService.js', 'createPost, approveReport, setConfirmation');
const warnings = await factory('warningService.js', 'watchVerifiedWarnings');
const apps = [];
function client(uid) {
    const app = initializeApp({ projectId: 'demo-fiu-chat', apiKey: 'emulator-only' }, uid); apps.push(app);
    sdk.connectFirestoreEmulator(sdk.getFirestore(app), '127.0.0.1', 8185, { mockUserToken: { sub: uid } });
    return { user: { uid, displayName: uid }, forum: forum(app, sdk), warnings: warnings(app, sdk) };
}
const author = client('reporter'), reviewer = client('reviewer'), observer = client('observer');
const root = 'http://127.0.0.1:8185/v1/projects/demo-fiu-chat/databases/(default)/documents';
async function admin(path, method, body) {
    const response = await fetch(root + path, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    assert.ok(response.ok, await response.text());
}
function seen(predicate) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stop(); reject(Error('Warning update timed out')); }, 10000);
        const stop = observer.warnings.watchVerifiedWarnings((reports, cached) => { if (!cached && predicate(reports)) { clearTimeout(timer); stop(); resolve(reports); } }, error => { clearTimeout(timer); reject(error); });
    });
}
try {
    const location = { label: 'Library', latitude: 25.75396, longitude: -80.37662 };
    const id = await author.forum.createPost(author.user, 'Walkway concern', 'Description', 'Alert', location);
    await seen(reports => reports.length === 0);
    await admin('/users/reviewer/roles/verifier', 'PATCH', { fields: { enabled: { booleanValue: true } } });
    const added = seen(reports => reports.length === 1);
    await reviewer.forum.approveReport(reviewer.user, id);
    const reports = await added; assert.equal(reports[0].id, id); assert.deepEqual(reports[0].location, location);
    const updated = seen(reports => reports[0]?.confirmationCount === 1);
    await observer.forum.setConfirmation(observer.user, id, true); await updated;
    const removed = seen(reports => reports.length === 0);
    await admin('/forums/' + id, 'PATCH', { fields: { category: { stringValue: 'Alert' } } });
    await removed;
    console.log('PASS: Firebase approved-only query, live approval addition, saved locations, confirmation updates, removal when approval disappears.');
} finally { await Promise.all(apps.map(deleteApp)); }
