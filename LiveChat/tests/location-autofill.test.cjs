const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'forums/alertUI.js'), 'utf8').replace(/^import.*;\s*/gm, '').replace('export function', 'function').replaceAll('import.meta.url', JSON.stringify('https://campus.test/LiveChat/forums/alertUI.js'));
const buildings = [
    { full_name: 'Green Library', abbreviation: 'GL', latitude: 25.757165, longitude: -80.373853 },
    { full_name: 'Recreation Center', abbreviation: 'RC', latitude: 25.753, longitude: -80.378 }
];
const tick = () => new Promise(resolve => setImmediate(resolve));
const point = (lat, lng) => ({ lat, lng, wrap() { return this; } });
function setup(fetchBuildings = async () => ({ ok: true, json: async () => buildings })) {
    const elements = {}, saved = [], mapEvents = {}, markerEvents = {};
    let markerPoint, requests = 0;
    function element() { return { _value: '', get value() { return this._value; }, set value(value) { this._value = String(value); }, children: [], dataset: {}, listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        dispatchEvent(event) { this.listeners[event.type]?.(event); if (event.bubbles) saved.push(ui.location()); },
        replaceChildren(...items) { this.children = items; }, setAttribute() {}, remove() {}
    }; }
    for (const [, id] of fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8').matchAll(/id="([^"]+)"/g)) elements[id] = element();
    const map = { setView() { return this; }, on(type, listener) { mapEvents[type] = listener; }, invalidateSize() {}, remove() {} };
    const marker = { addTo() { return this; }, setLatLng([lat, lng]) { markerPoint = point(lat, lng); }, getLatLng() { return markerPoint; }, on(type, listener) { markerEvents[type] = listener; return this; }, remove() {} };
    const L = { map: () => map, tileLayer: () => ({ addTo() {} }), marker: position => { marker.setLatLng(position); return marker; } };
    const lifecycle = { watchReportExpiry: () => ({ dispose() {} }) };
    const mount = new Function('service', 'document', 'window', 'lifecycle', 'matchMedia', 'fetch', 'setInterval', 'clearInterval',
        'const {expiresAt, reportState, alertStatus, alertLabels, visibleOnMap, watchReportExpiry} = lifecycle;\n' + source + '\nreturn mountAlerts;')(
        { watchVerifier: () => () => {} }, { getElementById: id => elements[id], createElement: element }, { L, addEventListener() {} }, lifecycle,
        () => ({ matches: true, addEventListener() {} }), () => { requests++; return fetchBuildings(); }, () => 0, () => {});
    const ui = mount({ user: { uid: 'reporter' } });
    ui.setComposer(true);
    return { ui, elements, saved, requests: () => requests,
        click: (lat, lng) => mapEvents.click({ latlng: point(lat, lng) }),
        drag: (lat, lng) => { markerPoint = point(lat, lng); return markerEvents.dragend(); },
        edit: (id, value) => { elements[id].value = value; elements[id].listeners.input?.(); }
    };
}

test('pin selection fills a nearby landmark, saves the label with the coordinates, and remains editable', async t => {
    const ctx = setup(); t.after(() => ctx.ui.dispose()); await tick();
    ctx.elements['alert-building'].value = 'Old building';
    await ctx.click(25.7572, -80.3739);
    assert.equal(ctx.ui.location().label, 'Near Green Library');
    assert.equal(ctx.elements['alert-building'].value, '');
    assert.deepEqual(ctx.saved.at(-1), { label: 'Near Green Library', latitude: 25.7572, longitude: -80.3739 });
    assert.equal(ctx.elements['alert-location-label'].disabled, false);
    ctx.edit('alert-location-label', 'Library east entrance');
    ctx.edit('alert-latitude', '25.75721');
    assert.equal(ctx.ui.location().label, 'Library east entrance', 'Normal edits do not replace custom text');
    await ctx.drag(25.753, -80.378);
    assert.equal(ctx.ui.location().label, 'Near Recreation Center');
    assert.equal(ctx.saved.at(-1).longitude, -80.378);
    await ctx.click(30, -90);
    assert.equal(ctx.ui.location().label, 'Map location (30.00000, -90.00000)', 'A distant pin must not claim to be near a campus building');
});

test('building search still fills its exact name and coordinates', async t => {
    const ctx = setup(); t.after(() => ctx.ui.dispose()); await tick();
    ctx.edit('alert-building', 'GL');
    await ctx.elements['alert-building'].listeners.change();
    assert.deepEqual(ctx.ui.location(), { label: 'Green Library', latitude: 25.757165, longitude: -80.373853 });
});

test('a slow building lookup only names the most recently selected pin', async t => {
    let resolve;
    const ctx = setup(() => new Promise(done => { resolve = done; })); t.after(() => ctx.ui.dispose()); await tick();
    const first = ctx.click(25.7572, -80.3739), second = ctx.click(25.753, -80.378);
    assert.equal(ctx.requests(), 1, 'Composer and pin share one building request');
    resolve({ ok: true, json: async () => buildings }); await Promise.all([first, second]);
    assert.deepEqual(ctx.saved.at(-1), { label: 'Near Recreation Center', latitude: 25.753, longitude: -80.378 });
});

test('a slow lookup preserves manual text and never repopulates a reset or closed form', async t => {
    for (const action of ['edit', 'reset', 'close', 'saving', 'dispose']) {
        let resolve;
        const ctx = setup(() => new Promise(done => { resolve = done; })); t.after(() => ctx.ui.dispose()); await tick();
        const selected = ctx.click(25.7572, -80.3739);
        if (action === 'edit') ctx.edit('alert-location-label', 'Library east entrance');
        if (action === 'reset') ctx.ui.reset();
        if (action === 'close') ctx.ui.setComposer(false);
        if (action === 'saving') ctx.ui.setDisabled(true);
        if (action === 'dispose') ctx.ui.dispose();
        const label = ctx.ui.location().label, saves = ctx.saved.length;
        resolve({ ok: true, json: async () => buildings }); await selected;
        assert.equal(ctx.ui.location().label, label, action);
        assert.equal(ctx.saved.length, saves, action);
    }
});

test('unavailable building data leaves a useful editable location and a working pin', async t => {
    const ctx = setup(async () => { throw Error('Offline'); }); t.after(() => ctx.ui.dispose()); await tick();
    await ctx.click(25.7572, -80.3739);
    assert.equal(ctx.ui.location().label, 'Map location (25.75720, -80.37390)');
    ctx.edit('alert-location-label', 'Outside Green Library');
    assert.equal(ctx.ui.location().label, 'Outside Green Library');
    ctx.ui.setDisabled(true); await ctx.click(25.753, -80.378); await ctx.drag(25.753, -80.378);
    assert.equal(ctx.ui.location().latitude, 25.7572, 'Saving blocks pin edits');
});
