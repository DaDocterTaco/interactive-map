import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { appearanceColors, appearanceIcons, logoInitials, validateAppearance, renderAppearance, centerSquare, prepareLogo, MAX_LOGO_FILE_BYTES } from '../groupAppearance.js';

const jpeg = 'data:image/jpeg;base64,/9j/AA==';
assert.deepEqual(validateAppearance({ kind: 'initials', color: 'blue', text: 'SG' }), { kind: 'initials', color: 'blue', text: 'SG' });
assert.equal(validateAppearance({ kind: 'icon', color: 'teal', icon: 'book' }).icon, 'book');
assert.equal(validateAppearance({ kind: 'image', color: 'rose', image: jpeg }).image, jpeg);
for (const value of [null, [], {}, { kind: 'initials', color: 'pink', text: 'A' },
    { kind: 'initials', color: 'blue', text: '' }, { kind: 'initials', color: 'blue', text: '<x>' },
    { kind: 'initials', color: 'blue', text: 'FOUR' }, { kind: 'initials', color: 'blue', text: 'SG', uid: 'owner' },
    { kind: 'icon', color: 'blue', icon: '../evil.svg' }, { kind: 'image', color: 'blue', image: 'https://example.com/logo.png' },
    { kind: 'image', color: 'blue', image: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { kind: 'image', color: 'blue', image: 'data:image/jpeg;base64,junk' },
    { kind: 'image', color: 'blue', image: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(32768) }
]) assert.throws(() => validateAppearance(value));
assert.equal(logoInitials('Study group'), 'SG'); assert.equal(logoInitials(''), 'GC');
assert.deepEqual(centerSquare(600, 400), { x: 100, y: 0, size: 400 });
assert.deepEqual(centerSquare(200, 600), { x: 0, y: 200, size: 200 });
assert.throws(() => centerSquare(0, 400)); assert.throws(() => centerSquare(10000, 10000));
const png = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])], { type: 'image/png' });
let closed = 0, draw;
const bitmap = { width: 600, height: 400, close() { closed++; } };
const canvas = { getContext() { return { fillRect() {}, drawImage(...args) { draw = args; } }; }, toDataURL(type) { assert.equal(type, 'image/jpeg'); return jpeg; } };
assert.equal(await prepareLogo(png, { decode: async () => bitmap, canvas: () => canvas }), jpeg);
assert.equal(canvas.width, 128); assert.equal(canvas.height, 128);
assert.deepEqual(draw.slice(1), [100, 0, 400, 400, 0, 0, 128, 128]); assert.equal(closed, 1);
await assert.rejects(prepareLogo(new Blob(['svg'], { type: 'image/svg+xml' })), /PNG, JPEG, or WebP/);
await assert.rejects(prepareLogo(new Blob(['broken'], { type: 'image/png' })), /does not match/);
await assert.rejects(prepareLogo(new Blob([], { type: 'image/png' })), /5 MB/);
await assert.rejects(prepareLogo(new Blob([new Uint8Array(MAX_LOGO_FILE_BYTES + 1)], { type: 'image/png' })), /5 MB/);
await assert.rejects(prepareLogo(png, { decode: async () => { throw Object.assign(Error('bad'), { name: 'InvalidStateError' }); } }), /could not be read/);
let attempts = 0;
assert.equal(await prepareLogo(png, { decode: async () => bitmap, canvas: () => ({ ...canvas, toDataURL() { return ++attempts < 3 ? 'x'.repeat(33000) : jpeg; } }) }), jpeg);
assert.equal(attempts, 3);
await assert.rejects(prepareLogo(png, { decode: async () => bitmap, canvas: () => ({ ...canvas, toDataURL: () => 'x'.repeat(33000) }) }), /too detailed/);

// Run the real editor against a minimal DOM: previews and async upload races are not mocked.
function node(tag = 'div') { return {
    tag, value: '', className: '', textContent: '', dataset: {}, attributes: {}, children: [], events: {}, files: [],
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(event, fn) { this.events[event] = fn; },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; this.textContent = ''; },
    querySelectorAll() { return controls; }
}; }
const nodes = {}, controls = [];
const fragment = await fs.readFile(new URL('../fragments/group-logo-create.html', import.meta.url), 'utf8');
for (const [, id] of fragment.matchAll(/id="([^"]+)"/g)) nodes[id] = node();
controls.push(nodes['create-logo-kind'], nodes['create-logo-text'], nodes['create-logo-file']);
globalThis.document = { getElementById: id => { assert.ok(nodes[id], id); return nodes[id]; }, createElement: tag => { const element = node(tag); if (tag === 'button') controls.push(element); return element; } };
const editorCode = (await fs.readFile(new URL('../appearanceUI.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '').replaceAll('export ', '');
let resolveUpload;
const fakeUpload = () => new Promise(resolve => { resolveUpload = resolve; });
const factory = new Function('appearanceColors', 'appearanceIcons', 'logoInitials', 'validateAppearance', 'renderAppearance', 'prepareLogo', editorCode + '\nreturn mountAppearanceEditor;');
const mount = factory(appearanceColors, appearanceIcons, logoInitials, validateAppearance, renderAppearance, fakeUpload);
let name = 'Study group', busy;
const editor = mount('create-logo', { getName: () => name, onBusy: value => { busy = value; } });
assert.equal(editor.value().text, 'SG');
name = 'Design club'; editor.updateName(); assert.equal(editor.value().text, 'DC');
nodes['create-logo-kind'].value = 'icon'; nodes['create-logo-kind'].events.change();
const book = nodes['create-logo-icons'].children.find(button => button.dataset.icon === 'book'); book.events.click();
assert.equal(editor.value().icon, 'book'); assert.equal(book.attributes['aria-pressed'], 'true');
nodes['create-logo-colors'].children.find(button => button.dataset.color === 'teal').events.click();
assert.equal(editor.value().color, 'teal');
editor.reset({ kind: 'initials', color: 'rose', text: 'ZZ' }); name = 'New name'; editor.updateName(); assert.equal(editor.value().text, 'ZZ');
nodes['create-logo-kind'].value = 'image'; nodes['create-logo-kind'].events.change();
assert.throws(() => editor.value(), /valid image/);
nodes['create-logo-file'].files = [png]; const upload = nodes['create-logo-file'].events.change();
assert.equal(busy, true); assert.throws(() => editor.value(), /Wait/);
editor.reset(); resolveUpload(jpeg); await upload;
assert.equal(editor.value().kind, 'initials', 'late upload cannot replace a cancelled/reopened editor');
assert.equal(busy, false);
nodes['create-logo-kind'].value = 'image'; nodes['create-logo-kind'].events.change();
const nextUpload = nodes['create-logo-file'].events.change(); resolveUpload(jpeg); await nextUpload;
assert.equal(editor.value().image, jpeg); assert.match(nodes['create-logo-error'].textContent, /Image ready/);
editor.setDisabled(true); assert.ok(controls.every(control => control.disabled)); editor.dispose();
delete globalThis.document;
console.log('PASS: strict appearance schema, bounded raster upload, crop/compression/decode failures, bitmap cleanup, previews, choices, cancel/reset and stale upload guards.');
