const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const elements = {};
function element() { return { value: '', textContent: '', hidden: false, disabled: false, dataset: {}, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } }; }
for (const [, id] of fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8').matchAll(/id="([^"]+)"/g)) elements[id] = element();
const source = fs.readFileSync(path.join(root, 'forums/alertUI.js'), 'utf8').replace(/^import.*;\s*/, '').replace('export function', 'function');
let receive, mapClick, saved, fail = false, markers = 0, removed = 0;
let roleChanged, roleError, approvedId, roleStopped = false, approvalResolve;
const map = { setView() { return this; }, on(type, cb) { mapClick = cb; }, invalidateSize() {}, remove() { removed++; } };
const L = { map: container => { assert.equal(container, elements['alert-location-map']); return map; }, tileLayer: () => ({ addTo() {} }), circleMarker: () => { markers++; return { addTo() { return this; }, setLatLng() {}, remove() {} }; } };
const service = {
    watchVerifier(uid, cb, error) { roleChanged = cb; roleError = error; return () => { roleStopped = true; }; },
    async approveReport(user, id) { if (fail) throw Error('Offline'); approvedId = id; await new Promise(resolve => { approvalResolve = resolve; }); },
    watchConfirmation(id, uid, cb) { receive = cb; return () => {}; }, async setConfirmation(user, id, value) { if (fail) throw Error('Offline'); saved = { id, value }; receive(value, false); }
};
const mount = new Function('service', 'document', 'window', source + '\nreturn mountAlerts;')(service, { getElementById: id => { assert.ok(elements[id], id); return elements[id]; } }, { L });
const post = { id: 'alert-a', category: 'Alert', authorId: 'author', location: { label: '<Library>', latitude: 25.75, longitude: -80.37 }, confirmationCount: 0 };
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const ui = mount({ user: { uid: 'reader', displayName: 'Reader' } });
    ui.setComposer(true); await tick();
    assert.equal(elements['alert-latitude'].required, true);
    assert.ok(Number.isNaN(ui.location().latitude));
    mapClick({ latlng: { lat: 25.75, wrap: () => ({ lng: -80.37 }) } });
    assert.equal(ui.location().latitude, 25.75); assert.equal(markers, 1);
    ui.setDisabled(true); mapClick({ latlng: { lat: 30, wrap: () => ({ lng: -90 }) } });
    assert.equal(ui.location().latitude, 25.75);
    ui.setDisabled(false); ui.render(post); receive(false, false);
    assert.equal(elements['alert-confirm'].disabled, false);
    assert.match(elements['alert-location-display'].textContent, /<Library>/);
    fail = true; await elements['alert-confirm'].listeners.click(); assert.match(elements['alert-confirm-status'].textContent, /Not saved/);
    fail = false; await elements['alert-confirm'].listeners.click(); assert.deepEqual(saved, { id: 'alert-a', value: true });
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
    ui.render({ ...post, verification: { status: 'approved', verifierName: '<Verifier>', approvedAt: { toDate: () => new Date() } } });
    assert.match(elements['alert-verification'].textContent, /Verified by <Verifier>/);
    assert.equal(elements['alert-approve'].hidden, true);
    assert.equal(elements['alert-verification'].dataset.approved, 'true');
    roleChanged(false); assert.equal(elements['alert-approve'].hidden, true);
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
