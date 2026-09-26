const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'chat.js'), 'utf8')
    .replaceAll('import("./chatAuth.js")', 'fakeAuth()')
    .replaceAll('import("./chatService.js")', 'fakeService()')
    .replaceAll('import("./groups.js")', 'fakeGroups()')
    .replaceAll('import("./groupUI.js")', 'fakeGroupUI()')
    .replaceAll('import("./forums/forumUI.js")', 'fakeForumUI()')
    .replaceAll('import("./people.js")', 'fakePeople()')
    .replaceAll('import("./peopleUI.js")', 'fakePeopleUI()');
const elements = {};
function element() {
    return {
        value: '', textContent: '', open: false, disabled: false, children: [], listeners: {},
        scrollHeight: 300, scrollTop: 300, clientHeight: 100,
        addEventListener(name, handler) { this.listeners[name] = handler; },
        setAttribute(name, value) { this[name] = value; },
        showModal() { this.open = true; },
        close() { this.open = false; this.listeners.close?.(); },
        focus() {}, reset() {}, setCustomValidity() {}, reportValidity() {},
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); }
    };
}
for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = element();
let roleChanged, roleError, roleStops = 0, removals = 0;
let receive, listenError, selectGroup, groupUpdated, requested, stops = 0, sends = 0, clears = 0, lastGroup;
let confirm = false, failSend = false, failClear = false, forumsActive = false, forumsDisposed = 0;
const auth = { restoreUser: async () => ({ uid: 'alice', displayName: 'Alice' }), watchUser() {} };
const service = {
    watchModerator(uid, callback, error) { roleChanged = callback; roleError = error; return () => roleStops++; },
    async removeMessage(user, id, reason) { assert.equal(id, 'message-1'); assert.equal(reason, 'Harmful content'); removals++; },
    watchMessages(callback, error) { receive = callback; listenError = error; return () => stops++; },
    async sendMessage(user, text, groupId) {
        lastGroup = groupId;
        assert.equal(user.uid, 'alice'); assert.equal(text, 'Hello');
        if (failSend) throw { code: 'permission-denied' };
        sends++;
    },
    async clearMessages(user, reason, progress) {
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
    window: { confirm: () => confirm, prompt: () => 'Harmful content' }, fakeAuth: async () => auth, fakeService: async () => service,
    setTimeout: () => 1, clearTimeout() {},
    fakePeople: async () => ({ saveProfile: async () => {} }),
    fakePeopleUI: async () => ({ mountPeople: () => ({ setConversation() {}, dispose() {} }) }),
    fakeForumUI: async () => ({ mountForums() { return { setActive(value) { forumsActive = value; }, dispose() { forumsDisposed++; } }; } }),
    fakeGroups: async () => ({ isClosed: group => group.closed, expiresAt: () => Date.now() + 43200000, watchRequests(callbackId, cb) { requested = cb; return () => {}; } }),
    fakeGroupUI: async () => ({ mountGroups({ onSelect, onGroupUpdated }) { selectGroup = onSelect; groupUpdated = onGroupUpdated; return { dispose() {} }; } })
});
const fire = (id, event) => elements[id].listeners[event]({ preventDefault() {} });
const messages = [{ id: 'message-1', senderId: 'bob', name: 'Bob', text: '<b>Hello</b>', createdAt: { toDate: () => new Date() }, pending: false }];
(async () => {
    await fire('open-chat', 'click');
    assert.equal(elements['chat-panel'].open, true);
    assert.equal(elements['send-message'].disabled, true);
    await fire('forums-tab', 'click');
    assert.equal(forumsActive, true);
    assert.equal(elements['chats-sidebar'].hidden, true);
    assert.equal(elements['chats-conversation'].hidden, true);
    assert.equal(elements['forums-panel'].hidden, false);
    assert.equal(elements['forums-tab']['aria-pressed'], 'true');
    await fire('chats-tab', 'click');
    assert.equal(forumsActive, false);
    assert.equal(elements['forums-panel'].hidden, true);
    receive(messages, false);
    assert.match(elements['message-list'].children[0].textContent, /Bob: <b>Hello<\/b>/);
    assert.equal(elements['clear-chat'].hidden, true);
    assert.equal(elements['message-list'].children[0].children.length, 0);
    confirm = true;
    await fire('clear-chat', 'click'); assert.equal(clears, 0);
    roleChanged(true);
    assert.equal(elements['clear-chat'].hidden, false);
    await elements['message-list'].children[0].children[0].listeners.click();
    assert.equal(removals, 1);
    roleChanged(false);
    assert.equal(elements['message-list'].children[0].children.length, 0);
    roleChanged(true);
    confirm = false;
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
    assert.equal(stops, 1); assert.equal(roleStops, 1);
    roleChanged(true); assert.equal(elements['clear-chat'].hidden, true);
    assert.equal(forumsDisposed, 1);
    await fire('open-chat', 'click');
    listenError({ code: 'permission-denied' });
    assert.equal(elements['send-message'].disabled, true);
    assert.match(elements['connection-status'].textContent, /denied access/);
    receive(messages, false);
    roleChanged(true);
    selectGroup({ id: 'dm:alice:bob', name: 'Bob', visibility: 'direct' });
    receive(messages, false);
    assert.equal(elements['clear-chat'].hidden, true);
    assert.equal(elements['message-list'].children[0].children.length, 0);
    selectGroup(null); receive(messages, false);
    roleError(); roleChanged(false);
    assert.equal(elements['clear-chat'].hidden, true);
    roleChanged(true);
    elements['message-input'].value = 'Campus draft';
    const group = { id: 'test-group', name: 'Study', visibility: 'private', creatorId: 'alice', idleHours: 12 };
    selectGroup(group);
    assert.equal(elements['clear-chat'].hidden, true);
    assert.equal(elements['group-settings'].hidden, false);
    assert.equal(elements['message-input'].value, '');
    receive(messages, false);
    elements['message-input'].value = 'Hello';
    await fire('message-form', 'submit');
    assert.equal(lastGroup, 'test-group');
    selectGroup(null);
    assert.equal(elements['message-input'].value, 'Campus draft');
    selectGroup(group);
    receive(messages, false);
    groupUpdated({ ...group, closed: true });
    assert.equal(elements['message-list'].children.length, 0);
    assert.equal(elements['send-message'].disabled, true);
    assert.match(elements['connection-status'].textContent, /closed/);
    console.log('PASS: HTML bindings, safe rendering, failed-send draft retention, no duplicate sends, Clear confirmation/offline guard/failure/retry, listener cleanup/errors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
