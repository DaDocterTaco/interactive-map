const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../mapChat.js'), 'utf8');
for (const withShell of [false, true]) for (const search of ['?forum=post123', '']) test(`Map loader opens only shared forum links: ${search || 'normal map'} (shell: ${withShell})`, async () => {
    let clicks = 0, handlers;
    const registrations = [];
    const status = { textContent: '' };
    const chatPanel = {};
    const window = withShell ? { CampusUI: { registerDialog: (...args) => registrations.push(args) } } : {};
    const trigger = { disabled: true, click() { assert.equal(this.disabled, false); clicks++; } };
    const document = {
        currentScript: { src: 'https://campus.test/LiveChat/mapChat.js' },
        getElementById: id => id === 'open-chat' ? trigger : id === 'chat-panel' ? chatPanel : status,
        importNode: node => node,
        createElement: () => ({}),
        body: { append(...nodes) { handlers = nodes.find(node => node.src) || handlers; } }
    };
    const page = { querySelectorAll: () => [], getElementById: () => ({}) };
    await vm.runInNewContext(source, { document, window, location: { search, href: "https://campus.test/index.html" + search }, URL, URLSearchParams,
        fetch: async () => ({ ok: true, text: async () => '<fixture>' }),
        DOMParser: class { parseFromString() { return page; } } });
    assert.equal(trigger.disabled, true);
    assert.equal(clicks, 0);
    assert.equal(status.textContent, '', 'Loading should not enter the error state');
    assert.ok(handlers, 'Chat controller should be appended after the panels');
    assert.deepEqual(registrations, withShell ? [[chatPanel, 'community']] : []);
    handlers.onload();
    assert.equal(trigger.disabled, false);
    assert.equal(clicks, search ? 1 : 0);
});
