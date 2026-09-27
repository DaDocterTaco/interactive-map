const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '..', 'chatViewport.js'), 'utf8')
    .replace('export function mountChatViewport', 'function mountChatViewport');
const mountChatViewport = new Function(code + '\nreturn mountChatViewport;')();

function eventTarget(initial = {}) {
    const listeners = new Map();
    return {
        ...initial,
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        },
        removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
        emit(type) { for (const callback of listeners.get(type) || []) callback(); },
        get listenerCount() { return [...listeners.values()].reduce((sum, list) => sum + list.size, 0); }
    };
}

function setup({ height = 844, visual = true, scale = 1 } = {}) {
    const viewport = visual ? eventTarget({ height, offsetTop: 0, scale }) : undefined;
    const view = eventTarget({ innerHeight: height, visualViewport: viewport });
    const styles = new Map(), attrs = new Map();
    const panel = {
        ownerDocument: { defaultView: view },
        style: {
            getPropertyValue: name => styles.get(name)?.value || '',
            getPropertyPriority: name => styles.get(name)?.priority || '',
            setProperty: (name, value, priority = '') => styles.set(name, { value, priority }),
            removeProperty: name => styles.delete(name)
        },
        getAttribute: name => attrs.get(name) ?? null,
        setAttribute: (name, value) => attrs.set(name, String(value)),
        removeAttribute: name => attrs.delete(name)
    };
    return {
        panel, view, viewport,
        height: () => panel.style.getPropertyValue('--chat-viewport-height'),
        offset: () => panel.style.getPropertyValue('--chat-viewport-offset'),
        compact: () => panel.getAttribute('data-compact-height'),
        tight: () => panel.getAttribute('data-tight-height')
    };
}

test('visible keyboard area and viewport panning update the sheet, then restore when the keyboard closes', () => {
    const s = setup();
    const ui = mountChatViewport(s.panel);
    assert.equal(s.height(), '844px');
    assert.equal(s.compact(), 'false');
    s.viewport.height = 390;
    s.viewport.offsetTop = 84;
    s.viewport.emit('resize');
    assert.equal(s.height(), '390px');
    assert.equal(s.offset(), '84px');
    assert.equal(s.compact(), 'true');
    assert.equal(s.tight(), 'true');
    s.viewport.offsetTop = 112;
    s.viewport.emit('scroll');
    assert.equal(s.offset(), '112px');
    s.viewport.height = 844;
    s.viewport.offsetTop = 0;
    s.viewport.emit('resize');
    assert.equal(s.height(), '844px');
    assert.equal(s.offset(), '0px');
    assert.equal(s.compact(), 'false');
    assert.equal(s.tight(), 'false');
    ui.dispose();
});

test('pinch zoom preserves layout dimensions and resumes visual sizing after zoom ends', () => {
    const s = setup();
    const ui = mountChatViewport(s.panel);
    Object.assign(s.viewport, { scale: 2, height: 422, offsetTop: 160 });
    s.viewport.emit('resize');
    s.viewport.emit('scroll');
    assert.equal(s.height(), '844px');
    assert.equal(s.offset(), '0px');
    assert.equal(s.compact(), 'false');
    Object.assign(s.viewport, { scale: 1, height: 590, offsetTop: 0 });
    s.viewport.emit('resize');
    assert.equal(s.height(), '590px');
    assert.equal(s.compact(), 'true');
    assert.equal(s.tight(), 'false');
    ui.dispose();
});

test('opening while already zoomed uses the layout viewport instead of a zoomed size', () => {
    const s = setup({ scale: 2 });
    s.viewport.height = 422;
    s.viewport.offsetTop = 200;
    const ui = mountChatViewport(s.panel);
    assert.equal(s.height(), '844px');
    assert.equal(s.offset(), '0px');
    assert.equal(s.compact(), 'false');
    ui.dispose();
});

test('browsers without visualViewport still respond to window resizing and height thresholds', () => {
    const s = setup({ visual: false, height: 600 });
    const ui = mountChatViewport(s.panel);
    assert.equal(s.compact(), 'true');
    assert.equal(s.tight(), 'false');
    s.view.innerHeight = 450;
    s.view.emit('resize');
    assert.equal(s.height(), '450px');
    assert.equal(s.tight(), 'true');
    s.view.innerHeight = 601;
    ui.refresh();
    assert.equal(s.compact(), 'false');
    assert.equal(s.tight(), 'false');
    ui.dispose();
});

test('transient invalid viewport readings do not inject unusable CSS dimensions', () => {
    const s = setup();
    const ui = mountChatViewport(s.panel);
    Object.assign(s.viewport, { height: NaN, offsetTop: -5 });
    s.viewport.emit('resize');
    assert.equal(s.height(), '844px');
    assert.equal(s.offset(), '0px');
    s.view.innerHeight = 0;
    s.viewport.height = 0;
    s.viewport.emit('resize');
    assert.equal(s.height(), '844px');
    ui.dispose();
});

test('dispose removes every listener and restores prior inline state without later writes', () => {
    const s = setup();
    s.panel.style.setProperty('--chat-viewport-height', '90dvh', 'important');
    s.panel.setAttribute('data-compact-height', 'existing');
    const ui = mountChatViewport(s.panel);
    assert.equal(s.viewport.listenerCount, 2);
    assert.equal(s.view.listenerCount, 1);
    ui.dispose();
    ui.dispose();
    assert.equal(s.viewport.listenerCount, 0);
    assert.equal(s.view.listenerCount, 0);
    assert.equal(s.height(), '90dvh');
    assert.equal(s.panel.style.getPropertyPriority('--chat-viewport-height'), 'important');
    assert.equal(s.offset(), '');
    assert.equal(s.compact(), 'existing');
    assert.equal(s.tight(), null);
    s.viewport.height = 300;
    s.viewport.emit('resize');
    s.view.emit('resize');
    ui.refresh();
    assert.equal(s.height(), '90dvh');
});
