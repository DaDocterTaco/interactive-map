// Emulator integration for the approved-report query and live map eligibility.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { visibleOnMap } from '../forums/reportLifecycle.js';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use local emulator');
sdk.setLogLevel('silent');
async function factory(file, exports) {
    const code = (await fs.readFile(new URL('../' + file, import.meta.url), 'utf8')).replace(/import[\s\S]*?from "[^"]+";\s*/g, '').replaceAll('export ', '');
    return new Function('app', 'sdk', `const { ${Object.keys(sdk).join(', ')} } = sdk;\n${code}\nreturn { ${exports} };`);
}
const forum = await factory('forums/forumService.js', 'createPost, approveReport, setConfirmation, reviewReport');
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
let lastReports = null, lastError = null;
const waiting = new Set();
const stopWarnings = observer.warnings.watchVerifiedWarnings((reports, cached) => {
    if (cached) return;
    lastReports = reports;
    for (const check of [...waiting]) check();
}, error => { lastError = error; for (const check of [...waiting]) check(); });
function seen(predicate, stage) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(check); reject(Error('Warning update timed out: '+stage)); }, 10000);
        function check() { if (lastError || lastReports && predicate(lastReports)) { clearTimeout(timer); waiting.delete(check); lastError ? reject(lastError) : resolve(lastReports); } }
        waiting.add(check); check();
    });
}
try {
    const location = { label: 'Library', latitude: 25.75396, longitude: -80.37662 };
    const id = await author.forum.createPost(author.user, 'Walkway concern', 'Description', 'Alert', location);
    await seen(reports => !reports.some(report => report.id === id), 'pending excluded');
    await admin('/users/reviewer/roles/verifier', 'PATCH', { fields: { enabled: { booleanValue: true } } });
    const added = seen(reports => reports.some(report => report.id === id), 'approved added');
    await reviewer.forum.approveReport(reviewer.user, id);
    const reports = await added; assert.deepEqual(reports.find(report => report.id === id).location, location);
    const updated = seen(reports => reports.find(report => report.id === id)?.confirmationCount === 1, 'observation');
    await observer.forum.setConfirmation(observer.user, id, true); await updated;
    const withdrawn = seen(reports => reports.some(report => report.id === id && report.rejection), 'withdrawal received');
    await reviewer.forum.reviewReport(reviewer.user, id, 'reject', 'Location was incorrect.', true);
    assert.equal(visibleOnMap((await withdrawn).find(report => report.id === id)), false);
    const removed = seen(reports => !reports.some(report => report.id === id), 'emulator record removed');
    await admin('/forums/' + id, 'DELETE');
    await removed;
    console.log('PASS: Firebase approved-only query, live approval addition, saved locations, confirmation updates, removal when approval disappears.');
} finally { stopWarnings(); await Promise.all(apps.map(deleteApp)); }
