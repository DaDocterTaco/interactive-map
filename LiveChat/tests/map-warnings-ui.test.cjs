// Fake Leaflet objects let this test inspect marker reconciliation and popup
// text without loading tiles or creating a real browser map.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^import.*;\s*/gm, '').replaceAll('export ', '');
const element = () => ({ textContent: '', children: [], attributes: {}, append(...items) { this.children.push(...items); }, setAttribute(k, v) { this.attributes[k] = v; } });
let status, created = 0, removedControl = false;
const layers = new Set();
const layer = { addTo() { return this; }, removeLayer(item) { layers.delete(item); }, clearLayers() { layers.clear(); }, remove() { layers.clear(); } };
const L = {
    layerGroup: () => layer, divIcon: options => options, DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {} },
    control: () => ({ addTo() { status = this.onAdd(); }, remove() { removedControl = true; } }),
    marker: (location, options) => { created++; return { location, options, element: element(), bindPopup(content) { this.content = content; return this; }, addTo(target) { assert.equal(target, layer); layers.add(this); return this; }, setPopupContent(content) { this.content = content; }, getElement() { return this.element; } }; }
};
let now = Date.now(), scheduled;
const lifecycle = require('./lifecycle-helper.cjs')({ Date: class extends Date { static now() { return now; } }, setTimeout: cb => { scheduled = cb; return 1; } });
const create = new Function('document', 'lifecycle', 'const {expiresAt, reportState, watchReportExpiry} = lifecycle;\n' + source('warningMarkers.js') + '\nreturn createWarningLayer;')({ createElement: element }, lifecycle);
const createdAt = now, stamp = { toDate: () => new Date(createdAt) };
const report = { id: 'one', title: '<img src=x onerror=alert(1)>', body: 'Concern\nDetails', category: 'Alert', location: { label: '<Library>', latitude: 25.75, longitude: -80.37 }, name: 'Reporter', confirmationCount: 2, createdAt: stamp, verification: { status: 'approved', verifierName: '<Reviewer>', approvedAt: stamp } };
const view = create({ map: {}, L });
view.setReports([report, { ...report, id: 'pending', verification: null }, { ...report, id: 'bad', location: { latitude: NaN, longitude: 0 } }, { ...report, id: 'local', pending: true }]);
assert.equal(layers.size, 1); assert.match(status.textContent, /^1 verified warning$/);
const marker = [...layers][0]; assert.deepEqual(marker.location, [25.75, -80.37]);
assert.equal(marker.content.children[0].children[1].textContent, report.title);
assert.equal(marker.content.children[0].children[3].textContent, report.body);
assert.match(marker.content.children[0].children.at(-2).textContent, /<Reviewer>/);
assert.equal(marker.element.attributes['aria-label'], `Verified warning: ${report.title}`);
view.setReports([report, { ...report, id: 'two', title: 'Second report' }]);
assert.equal(layers.size, 1); assert.equal(created, 1); assert.equal(marker.content.children.length, 2);
assert.match(status.textContent, /^2 verified warnings$/);
view.setReports([{ ...report, confirmationCount: 3 }], true);
assert.equal(created, 1); assert.match(marker.content.children[0].children[4].textContent, /3 user confirmations/); assert.match(status.textContent, /reconnecting/);
view.setReports([{ ...report, location: { ...report.location, latitude: 26 } }]);
assert.equal(layers.size, 1); assert.equal(created, 2);
view.setReports([{ ...report, verification: null }]); assert.equal(layers.size, 0);
view.setReports([report]); assert.equal(layers.size, 1);
now += 86400000; scheduled(); assert.equal(layers.size, 0); assert.match(status.textContent, /^0 verified/);
view.setReports([{ ...report, createdAt: { toMillis: () => now }, resolution: { status: 'resolved' } }]); assert.equal(layers.size, 0);
view.dispose(); assert.equal(removedControl, true);

let authChanged, readReports, readError, unsubscribed = 0, stoppedAuth = false, viewDisposed = false, shown, message, unload;
const controllerFactory = new Function('restoreUser', 'watchUser', 'watchVerifiedWarnings', 'createWarningLayer', source('mapWarnings.js') + '\nreturn mountMapWarnings;');
const mount = controllerFactory(async () => {}, cb => { authChanged = cb; return () => { stoppedAuth = true; }; }, (cb, err) => { readReports = cb; readError = err; return () => unsubscribed++; }, () => ({ clear() { shown = []; }, setReports(reports) { shown = reports; }, setStatus(text) { message = text; }, dispose() { viewDisposed = true; } }));
(async () => {
    const controller = mount({ map: { on(type, cb) { unload = cb; }, off() {} }, L });
    await new Promise(resolve => setImmediate(resolve));
    authChanged(null); assert.match(message, /Open chat/);
    authChanged({ uid: 'one' }); readReports([report]); assert.equal(shown.length, 1);
    const stale = readReports; authChanged({ uid: 'two' }); stale([report]); assert.equal(shown.length, 0);
    readReports([report]); readError(Error('Denied')); assert.equal(shown.length, 0); assert.match(message, /unavailable/);
    authChanged(null); assert.equal(unsubscribed, 2);
    unload(); controller.dispose(); assert.equal(stoppedAuth, true); assert.equal(viewDisposed, true);
    console.log('PASS: approved-only markers, safe popup text, exact saved coordinates, overlapping reports, live updates/removals, cache status, sign-in/out, stale-listener guards and disposal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
