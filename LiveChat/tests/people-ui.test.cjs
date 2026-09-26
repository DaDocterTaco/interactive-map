// A minimal DOM and service stub verify people UI behavior without a browser.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'peopleUI.js'), 'utf8').replace(/^import[^\n]+\n/, '').replaceAll('export ', '');
const elements = {};
function element() { return {
    value: '', textContent: '', children: [], events: {}, attributes: {}, hidden: false, open: false,
    addEventListener(event, fn) { this.events[event] = fn; }, setAttribute(name, value) { this.attributes[name] = value; },
    append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); }, replaceChildren() { this.children = []; },
    showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.events.close?.(); } }
}; }
for (const [, id] of fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8').matchAll(/id="([^"]+)"/g)) elements[id] = element();
let friendsCallback, directsCallback, membersCallback, selected, timer, saved = 0, removed = 0, stops = 0;
const alice = { uid: 'alice', displayName: 'Alice' }, bob = { uid: 'bob', displayName: '<Bob>' };
const service = {
    getProfile: async uid => uid === 'alice' ? alice : bob,
    searchPeople: async () => [bob],
    watchFriends(uid, cb) { friendsCallback = cb; return () => stops++; },
    watchDirects(uid, cb) { directsCallback = cb; return () => stops++; },
    watchMembers(id, cb) { assert.equal(id, 'Study'); membersCallback = cb; return () => stops++; },
    async openDirect() { return { id: 'dm:alice:bob', name: bob.displayName, otherId: 'bob', visibility: 'direct' }; },
    async saveFriend() { saved++; friendsCallback([{ id: 'bob' }]); },
    async removeFriend() { removed++; friendsCallback([]); }
};
const mount = new Function('people', 'document', 'setTimeout', 'clearTimeout', code + '\nreturn mountPeople;')(service,
    { getElementById: id => { assert.ok(elements[id], id); return elements[id]; }, createElement: element }, cb => { timer = cb; return 1; }, () => {});
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const ui = mount({ user: alice, onSelect: chat => { selected = chat; ui.setConversation(chat); } });
    ui.setConversation(null); assert.equal(elements['show-members'].hidden, true);
    elements['chat-search'].value = 'Bo'; elements['chat-search'].events.input(); await timer();
    const person = elements['people-results'].children[0];
    assert.equal(person.children[0].children[1].children[0].textContent, '<Bob>');
    assert.match(person.children[0].children[0].className, /^avatar avatar-tone-[0-4]$/);
    assert.equal(person.children[0].children[0].attributes['aria-hidden'], 'true');
    assert.equal(person.children[1].textContent, 'Save');
    assert.equal(person.children[1].attributes['aria-label'], 'Save friend <Bob>');
    await person.children[1].events.click(); await tick(); assert.equal(saved, 1);
    // Clearing search restores the saved friend, independently of the search result.
    elements['chat-search'].value = ''; elements['chat-search'].events.input(); await tick();
    assert.equal(elements['friends-list'].children.length, 1);
    await elements['friends-list'].children[0].children[0].events.click();
    assert.equal(selected.id, 'dm:alice:bob'); assert.equal(elements['show-members'].hidden, true);
    assert.equal(elements['chat-panel'].attributes['data-mobile-view'], 'conversation');
    directsCallback([{ id: 'dm:alice:bob', visibility: 'direct', participantIds: ['alice', 'bob'] }]); await tick();
    assert.equal(elements['direct-list'].children.length, 0, 'a saved friend appears once instead of duplicating its DM');
    assert.equal(elements['direct-section'].hidden, true);
    ui.setConversation({ id: 'Study', name: 'Study', visibility: 'private' });
    assert.equal(elements['show-members'].hidden, false);
    elements['show-members'].events.click(); membersCallback(['alice', 'bob']); await tick();
    assert.equal(elements['members-list'].children.length, 2);
    assert.equal(elements['members-list'].children.find(row => row.children[0].children[1].children[0].textContent.includes('(you)')).children[0].disabled, true);
    const member = elements['members-list'].children.find(row => row.children[0].children[1].children[0].textContent === '<Bob>');
    assert.equal(member.children[1].textContent, 'Saved');
    assert.equal(member.children[1].attributes['aria-label'], 'Remove friend <Bob>');
    await member.children[1].events.click(); await tick(); assert.equal(removed, 1);
    assert.equal(elements['direct-list'].children.length, 1, 'removing a friend keeps its direct conversation');
    assert.equal(elements['friends-section'].hidden, true);
    await member.children[0].events.click(); assert.equal(elements['members-panel'].open, false);
    ui.dispose(); assert.ok(stops >= 3);
    console.log('PASS: combined people search, safe names, save/remove friends, direct selection, private group member list, no Campus/DM member button, modal and listener cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
