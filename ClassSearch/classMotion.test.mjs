import test from 'node:test';
import assert from 'node:assert/strict';
import { locateOnMap } from './classMotion.mjs';

function fixture() {
    const listeners = new Map(), inputs = new Map();
    const map = {
        center: [0, 0], zoom: 16, flights: [], stops: 0, views: [],
        getContainer: () => ({ addEventListener: (name, fn) => inputs.set(name, fn), removeEventListener: name => inputs.delete(name) }),
        on: (name, fn) => listeners.set(name, fn), off: name => listeners.delete(name),
        getCenter() { return this.center; }, getZoom() { return this.zoom; }, getMaxZoom: () => 19,
        distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000,
        stop() { this.stops++; listeners.get('moveend')?.(); },
        flyTo(...args) { this.flights.push(args); },
        setView(center, zoom, options) { this.center = center; this.zoom = zoom; this.views.push(options); },
    };
    let arrivals = 0, cancellations = 0;
    const start = extra => locateOnMap({ map, coordinates: [1, 1], onArrival: () => arrivals++, onCancel: () => cancellations++, ...extra });
    return { map, inputs, listeners, start, arrive() { map.center = [1, 1]; listeners.get('moveend')?.(); }, counts: () => [arrivals, cancellations] };
}
test('gentle flight announces arrival only after reaching the building and cleans up', () => {
    const f = fixture(); f.start();
    assert.equal(f.map.flights[0][2].duration, 3.2);
    assert.deepEqual(f.counts(), [0, 0]);
    f.arrive();
    assert.deepEqual(f.counts(), [1, 0]);
    assert.equal(f.listeners.size + f.inputs.size, 0);
});
test('reduced motion immediately locates without starting a flight', () => {
    const f = fixture(); f.start({ reducedMotion: true });
    assert.equal(f.map.flights.length, 0);
    assert.deepEqual(f.map.views, [{ animate: false }]);
    assert.deepEqual(f.counts(), [1, 0]);
});
test('repeated locate at the same building finishes even without moveend', () => {
    const f = fixture(); f.map.center = [1, 1]; f.map.zoom = 18; f.start();
    assert.deepEqual(f.counts(), [1, 0]); assert.equal(f.map.flights.length, 0);
});
for (const input of ['pointerdown', 'wheel', 'keydown']) {
    test(`${input} interrupts movement without a false arrival`, () => {
        const f = fixture(); const cancel = f.start();
        f.inputs.get(input)({ key: 'Escape' }); cancel(); f.arrive();
        assert.deepEqual(f.counts(), [0, 1]);
        assert.equal(f.listeners.size + f.inputs.size, 0);
    });
}
test('another map feature moving elsewhere cancels the class flight', () => {
    const f = fixture(); f.start(); f.listeners.get('moveend')();
    assert.deepEqual(f.counts(), [0, 1]);
});
test('normal keyboard tabbing leaves the journey running', () => {
    const f = fixture(); f.start(); f.inputs.get('keydown')({ key: 'Tab' });
    assert.deepEqual(f.counts(), [0, 0]); f.arrive(); assert.deepEqual(f.counts(), [1, 0]);
});
