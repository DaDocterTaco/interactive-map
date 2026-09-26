// Stub Leaflet, DOM, and forum services to test the alert picker and controls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const elements = {};
function element() { return { value: '', textContent: '', hidden: false, disabled: false, open: false, dataset: {}, listeners: {}, setAttribute(key, value) { this[key] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; } }; }
for (const file of [path.join(root, 'mainChat.html'), path.join(root, '../fragments/forums-panel.html')].filter(file => fs.existsSync(file))) for (const [, id] of fs.readFileSync(file, 'utf8').matchAll(/id="([^"]+)"/g)) elements[id] = element();
const source = fs.readFileSync(path.join(root, 'forums/alertUI.js'), 'utf8').replace(/^import.*;\s*/gm, '').replace('export function', 'function');
let receive, mapClick, saved, fail = false, markers = 0, removed = 0;
let roleChanged, roleError, approvedId, roleStopped = false, approvalResolve, resolved;
const map = { setView() { return this; }, on(type, cb) { mapClick = cb; }, invalidateSize() {}, remove() { removed++; } };
const L = { map: container => { assert.equal(container, elements['alert-location-map']); return map; }, tileLayer: () => ({ addTo() {} }), circleMarker: () => { markers++; return { addTo() { return this; }, setLatLng() {}, remove() {} }; } };
const service = {
    async resolveReport(user, id, note) { if (fail) throw Error('Offline'); resolved = { id, note }; },
    watchVerifier(uid, cb, error) { roleChanged = cb; roleError = error; return () => { roleStopped = true; }; },
    async approveReport(user, id) { if (fail) throw Error('Offline'); approvedId = id; await new Promise(resolve => { approvalResolve = resolve; }); },
    watchConfirmation(id, uid, cb) { receive = cb; return () => {}; }, async setConfirmation(user, id, value) { if (fail) throw Error('Offline'); saved = { id, value }; receive(value, false); }
};
const mount = new Function('service', 'document', 'window', 'lifecycle', 'const {expiresAt, reportState, watchReportExpiry} = lifecycle;\n' + source + '\nreturn mountAlerts;')(service, { getElementById: id => { assert.ok(elements[id], id); return elements[id]; } }, { L }, require('./lifecycle-helper.cjs')());
const post = { id: 'alert-a', category: 'Alert', authorId: 'author', createdAt: { toMillis: () => Date.now() }, location: { label: '<Library>', latitude: 25.75, longitude: -80.37 }, confirmationCount: 0 };
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const ui = mount({ user: { uid: 'reader', displayName: 'Reader' } });
    ui.setComposer(true); await tick();
    assert.equal(elements['alert-latitude'].required, true);
    assert.ok(Number.isNaN(ui.location().latitude));
    elements['alert-latitude'].listeners.invalid();
    assert.equal(elements['alert-coordinate-options'].open, true, 'Required coordinate validation opens its disclosure so the browser can focus it');
    mapClick({ latlng: { lat: 25.75, wrap: () => ({ lng: -80.37 }) } });
    assert.equal(ui.location().latitude, 25.75); assert.equal(markers, 1);
    ui.setDisabled(true); mapClick({ latlng: { lat: 30, wrap: () => ({ lng: -90 }) } });
    assert.equal(ui.location().latitude, 25.75);
    ui.setDisabled(false); ui.render(post); receive(false, false);
    assert.equal(elements['alert-resolve-fields'].open, false);
    assert.equal(elements['alert-confirm'].disabled, false);
    assert.match(elements['alert-location-display'].textContent, /<Library>/);
    assert.equal(elements['alert-location-display'].textContent.includes('25.750000'), false, 'Coordinates stay out of the primary location label');
    assert.equal(elements['alert-location-display'].title, '25.750000, -80.370000');
    assert.equal(elements['alert-verification'].textContent, 'Needs review');
    fail = true; await elements['alert-confirm'].listeners.click(); assert.match(elements['alert-confirm-status'].textContent, /Not saved/);
    fail = false; await elements['alert-confirm'].listeners.click(); assert.deepEqual(saved, { id: 'alert-a', value: true });
    assert.equal(elements['alert-confirm'].textContent, 'Undo confirmation');
    assert.equal(elements['alert-confirm-status'].dataset.state, 'success');
    fail = true; await elements['alert-confirm'].listeners.click();
    assert.equal(elements['alert-confirm-status'].dataset.state, 'error', 'A later error must restore visible feedback after a screen-reader-only success');
    assert.match(elements['alert-confirm-status'].textContent, /Not saved/);
    fail = false;
    await elements['alert-confirm'].listeners.click(); assert.equal(saved.value, false);
    assert.equal(elements['alert-approve'].hidden, true);
    await elements['alert-approve'].listeners.click(); assert.equal(approvedId, undefined);
    roleChanged(true); assert.equal(elements['alert-approve'].hidden, false);
    roleError(Error('Offline')); assert.equal(elements['alert-approve'].hidden, true);
    roleChanged(true);
    fail = true; await elements['alert-approve'].listeners.click(); assert.match(elements['alert-approval-status'].textContent, /not saved/);
    fail = false;
    const approving = elements['alert-approve'].listeners.click(); assert.equal(elements['alert-approve'].disabled, true);
    ui.render({ ...post, id: 'different' }); approvalResolve(); await approving;
    assert.equal(elements['alert-approval-status'].textContent, '');
    const verified = elements['alert-approve'].listeners.click(); approvalResolve(); await verified;
    assert.equal(elements['alert-approval-status'].dataset.state, 'success');
    ui.render({ ...post, verification: { status: 'approved', verifierName: '<Verifier>', approvedAt: { toDate: () => new Date() } } });
    assert.match(elements['alert-verification'].textContent, /Verified by <Verifier>/);
    assert.equal(elements['alert-approve'].hidden, true);
    assert.equal(elements['alert-verification'].dataset.approved, 'true');
    roleChanged(false); assert.equal(elements['alert-approve'].hidden, true);
    assert.equal(elements['alert-resolve-fields'].hidden, true);
    roleChanged(true); assert.equal(elements['alert-resolve-fields'].hidden, false);
    elements['alert-resolution-note'].value = 'Fixed'; fail = true;
    await elements['alert-resolve'].listeners.click(); assert.equal(elements['alert-resolution-note'].value, 'Fixed');
    assert.match(elements['alert-resolution-status'].textContent, /not saved/); fail = false;
    await elements['alert-resolve'].listeners.click(); assert.deepEqual(resolved, { id: post.id, note: 'Fixed' });
    assert.equal(elements['alert-resolution-status'].dataset.state, 'success');
    ui.render({ ...post, resolution: { status: 'resolved', resolvedName: '<Reader>', note: '<Fixed>' } });
    assert.equal(elements['alert-resolve-fields'].hidden, true); assert.equal(elements['alert-confirm'].hidden, true);
    assert.equal(elements['alert-verification'].textContent, 'Resolved');
    assert.match(elements['alert-lifecycle'].textContent, /<Reader>/); assert.match(elements['alert-lifecycle'].textContent, /<Fixed>/);
    ui.render({ ...post, createdAt: { toMillis: () => Date.now() - 86400001 } });
    assert.equal(elements['alert-approve'].hidden, true); assert.equal(elements['alert-confirm'].hidden, true);
    assert.equal(elements['alert-verification'].textContent, 'Expired');
    assert.equal(elements['alert-lifecycle'].textContent, 'Kept for reference.');
    const stale = receive; ui.render({ ...post, id: 'alert-b', authorId: 'reader' }); stale(true, false);
    assert.equal(elements['alert-confirm'].hidden, true);
    roleChanged(true); assert.equal(elements['alert-approve'].hidden, true);
    ui.render(null); assert.equal(elements['alert-details'].hidden, true);
    ui.reset(); assert.equal(elements['alert-latitude'].value, '');
    ui.setComposer(false); assert.equal(elements['alert-location-label'].required, false);
    ui.dispose(); assert.equal(removed, 1);
    assert.equal(roleStopped, true);
    console.log('PASS: independent picker, required coordinates, blocked edits during saves, safe location text, confirm/withdraw and failure states, author restriction, stale listener guards and disposal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
