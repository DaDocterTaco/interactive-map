const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../mapChat.js'), 'utf8');
for (const search of ['?forum=post123', '']) test(`Map loader opens only shared forum links: ${search || 'normal map'}`, async () => {
    let clicks = 0, handlers;
    const trigger = { disabled: true, click() { assert.equal(this.disabled, false); clicks++; } };
    const document = {
        currentScript: { src: 'https://campus.test/LiveChat/mapChat.js' },
        getElementById: id => id === 'open-chat' ? trigger : {},
        importNode: node => node,
        createElement: () => ({}),
        body: { append(...nodes) { handlers = nodes.find(node => node.src) || handlers; } }
    };
    const page = { querySelectorAll: () => [], getElementById: () => ({}) };
    await vm.runInNewContext(source, { document, location: { search, href: "https://campus.test/index.html" + search }, URL, URLSearchParams,
        fetch: async () => ({ ok: true, text: async () => '<fixture>' }),
        DOMParser: class { parseFromString() { return page; } } });
    assert.equal(trigger.disabled, true);
    assert.equal(clicks, 0);
    handlers.onload();
    assert.equal(trigger.disabled, false);
    assert.equal(clicks, search ? 1 : 0);
});
