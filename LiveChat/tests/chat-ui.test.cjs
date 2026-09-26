const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'chat.js'), 'utf8')
    .replaceAll('import("./chatAuth.js")', 'fakeAuth()')
    .replaceAll('import("./chatService.js")', 'fakeService()');
const elements = {};
function element() {
    return {
        value: '', textContent: '', open: false, disabled: false, children: [], listeners: {},
        scrollHeight: 300, scrollTop: 300, clientHeight: 100,
        addEventListener(name, handler) { this.listeners[name] = handler; },
        showModal() { this.open = true; },
        close() { this.open = false; this.listeners.close?.(); },
        focus() {}, reset() {}, setCustomValidity() {}, reportValidity() {},
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); }
    };
}
for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = element();
let receive, listenError, stops = 0, sends = 0, clears = 0;
let confirm = false, failSend = false, failClear = false;
const auth = { restoreUser: async () => ({ uid: 'alice', displayName: 'Alice' }), watchUser() {} };
const service = {
    watchMessages(callback, error) { receive = callback; listenError = error; return () => stops++; },
    async sendMessage(user, text) {
        assert.equal(user.uid, 'alice'); assert.equal(text, 'Hello');
        if (failSend) throw { code: 'permission-denied' };
        sends++;
    },
    async clearMessages(progress) {
        clears++;
        if (failClear) throw Error('Network interrupted');
        progress(3, 3); receive([], false); return 3;
    }
};
vm.runInNewContext(code, {
    document: {
        getElementById(id) { assert.ok(elements[id], 'Missing HTML element ' + id); return elements[id]; },
        createElement: element
    },
    location: { protocol: 'http:' }, localStorage: { removeItem() {} },
    window: { confirm: () => confirm }, fakeAuth: async () => auth, fakeService: async () => service
});
const fire = (id, event) => elements[id].listeners[event]({ preventDefault() {} });
const messages = [{ senderId: 'bob', name: 'Bob', text: '<b>Hello</b>', createdAt: { toDate: () => new Date() }, pending: false }];
(async () => {
    await fire('open-chat', 'click');
    assert.equal(elements['chat-panel'].open, true);
    assert.equal(elements['send-message'].disabled, true);
    receive(messages, false);
    assert.match(elements['message-list'].children[0].textContent, /Bob: <b>Hello<\/b>/);
    elements['message-input'].value = 'Hello';
    failSend = true;
    await fire('message-form', 'submit');
    assert.equal(elements['message-input'].value, 'Hello');
    assert.match(elements['message-status'].textContent, /not saved/);
    failSend = false;
    await fire('message-form', 'submit');
    assert.equal(sends, 1);
    assert.equal(elements['message-input'].value, '');
    // The snapshot listener alone renders messages; Send must not duplicate them.
    assert.equal(elements['message-list'].children.length, 1);
    await fire('clear-chat', 'click');
    assert.equal(clears, 0);
    confirm = true;
    receive(messages, true);
    await fire('clear-chat', 'click');
    assert.equal(clears, 0);
    receive(messages, false);
    failClear = true;
    await fire('clear-chat', 'click');
    assert.match(elements['message-status'].textContent, /did not finish/);
    assert.equal(elements['clear-chat'].disabled, false);
    failClear = false;
    await fire('clear-chat', 'click');
    assert.equal(elements['message-list'].children.length, 0);
    assert.match(elements['message-status'].textContent, /Deleted 3/);
    await fire('close-chat', 'click');
    assert.equal(stops, 1);
    await fire('open-chat', 'click');
    listenError({ code: 'permission-denied' });
    assert.equal(elements['send-message'].disabled, true);
    assert.match(elements['connection-status'].textContent, /denied access/);
    console.log('PASS: HTML bindings, safe rendering, failed-send draft retention, no duplicate sends, Clear confirmation/offline guard/failure/retry, listener cleanup/errors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
