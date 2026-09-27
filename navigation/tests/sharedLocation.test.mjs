import test from 'node:test';
import assert from 'node:assert/strict';
import { mountLocationServices } from '../../locationservices/leafletLocation.js';

test('shared location subscription and follow control retain one watch and clean up listeners', async () => {
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  globalThis.document = new EventTarget(); globalThis.document.hidden = false;
  globalThis.window = new EventTarget();
  const label = { textContent: '' }, button = new EventTarget();
  button.querySelector = () => label; button.dataset = {}; button.setAttribute = () => {};
  const stop = new EventTarget(), status = { textContent: '' };
  const layers = new Set(); let moves = 0, watches = 0, receive, clearCount = 0;
  const map = { on() {}, off() {}, hasLayer: layer => layers.has(layer), removeLayer: layer => layers.delete(layer),
    getMaxZoom: () => 19, getZoom: () => 16, setView() { moves++; }, panTo() { moves++; } };
  const layer = () => ({ setLatLng() { return this; }, setRadius() { return this; }, addTo() { layers.add(this); return this; } });
  const geolocation = { watchPosition(success) { watches++; receive = success; return 0; }, clearWatch(id) { assert.equal(id, 0); clearCount++; } };
  const boundary = { type: 'Polygon', coordinates: [[[-81, 24], [-79, 24], [-79, 26], [-81, 26], [-81, 24]]] };
  let service;
  try {
    service = mountLocationServices({ map, L: { circle: layer, circleMarker: layer }, locateButton: button, stopButton: stop,
      statusElement: status, geolocation, secureContext: true, fetchBoundary: async () => ({ ok: true, json: async () => boundary }) });
    const states = []; const unsubscribe = service.subscribe(value => states.push(value));
    service.setFollowing(false); await service.start(); await service.start(); assert.equal(watches, 1);
    const timestamp = Date.now(); receive({ coords: { latitude: 25, longitude: -80, accuracy: 5 }, timestamp });
    assert.equal(moves, 0); assert.equal(states.at(-1).status, 'tracking'); assert.equal(layers.size, 2);
    states.at(-1).fix.latitude = 0; assert.equal(service.getState().fix.latitude, 25);
    service.setFollowing(true); receive({ coords: { latitude: 25, longitude: -80, accuracy: 5 }, timestamp: timestamp + 1 });
    assert.equal(moves, 1); unsubscribe(); const count = states.length; service.stop();
    assert.equal(states.length, count); assert.equal(clearCount, 1); assert.equal(layers.size, 0);
  } finally { service?.dispose(); globalThis.document = priorDocument; globalThis.window = priorWindow; }
});
