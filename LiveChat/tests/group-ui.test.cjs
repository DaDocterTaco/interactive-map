const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'groupUI.js'), 'utf8').replace(/^import[^\n]+\n/, '').replaceAll('export ', '');
const elements = {};
function element() {
    return {
        value: '', textContent: '', children: [], attributes: {}, events: {}, open: false,
        addEventListener(name, handler) { this.events[name] = handler; },
        setAttribute(name, value) { this.attributes[name] = value; },
        replaceChildren() { this.children = []; },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); },
        showModal() { this.open = true; }, close() { this.open = false; this.events.close?.(); },
        focus() {}, reset() {}
    };
}
for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = element();
const group = { id: 'private', name: 'Study', visibility: 'private', creatorId: 'alice', idleHours: 12 };
const publicGroup = { id: 'public', name: 'Football', visibility: 'public', creatorId: 'alice', idleHours: 12 };
let groupsChanged, pinsChanged, requestChanged, membershipChanged, selected, pinOperation, created, hours, requests = 0, joins = 0, disposed = 0;
const groups = {
    isClosed: group => !!group.closed,
    watchGroups(cb) { groupsChanged = cb; return () => disposed++; },
    watchPins(uid, cb) { assert.equal(uid, 'alice'); pinsChanged = cb; return () => disposed++; },
    async setPinned(uid, id, pinned) { pinOperation = { uid, id, pinned }; pinsChanged(new Set(pinned ? [id] : [])); },
    async isMember() { return false; },
    async joinGroup(group, user, password) { if (group.visibility === 'private' && password !== 'correct') throw { code: 'permission-denied' }; joins++; },
    watchMyRequest(id, uid, cb) { requestChanged = cb; return () => {}; },
    watchMembership(id, uid, cb) { membershipChanged = cb; return () => {}; },
    async requestAccess() { requests++; requestChanged({ status: 'pending' }); },
    async createGroup(user, values) { created = values; return { ...group, id: 'new' }; },
    async changeIdleHours(id, value) { hours = { id, value }; }
};
const mount = new Function('groups', 'document', 'setInterval', 'clearInterval', code + '\nreturn mountGroups;')(groups, {
    getElementById: id => { assert.ok(elements[id], `Missing ${id}`); return elements[id]; }, createElement: element
}, () => 1, () => {});
const fire = (id, event) => elements[id].events[event]({ preventDefault() {} });
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const controller = mount({ user: { uid: 'alice', displayName: 'Alice' }, onSelect: group => { selected = group; }, onGroupUpdated() {} });
    groupsChanged([group, publicGroup, { ...group, id: 'closed', closed: true }]);
    assert.equal(elements['other-groups'].children.length, 2);
    assert.equal(elements['other-groups'].children[1].className, 'group-row private');
    await elements['other-groups'].children[1].children[1].events.click();
    assert.deepEqual(pinOperation, { uid: 'alice', id: 'private', pinned: true });
    assert.equal(elements['pinned-groups'].children.length, 1);
    assert.equal(elements['other-groups'].children.length, 1);
    elements['chat-search'].value = 'study'; await fire('chat-search', 'input');
    assert.equal(elements['other-groups'].children.length, 0);
    assert.equal(elements['campus-chat-choice'].attributes['aria-current'], 'true');
    elements['pinned-groups'].children[0].children[0].events.click(); await tick();
    assert.equal(elements['join-group-panel'].open, true);
    elements['join-group-password'].value = 'incorrect';
    await fire('join-group-form', 'submit');
    assert.equal(selected, undefined);
    assert.match(elements['join-group-status'].textContent, /Incorrect password/);
    await fire('request-group-access', 'click');
    assert.equal(requests, 1);
    assert.equal(elements['request-group-access'].disabled, true);
    requestChanged({ status: 'denied' });
    assert.match(elements['join-group-status'].textContent, /denied/);
    assert.equal(elements['request-group-access'].disabled, false);
    await fire('request-group-access', 'click');
    membershipChanged(true);
    assert.equal(selected.id, 'private');
    assert.equal(elements['join-group-panel'].open, false);
    assert.equal(elements['join-group-password'].value, '');
    await fire('group-settings', 'click');
    elements['settings-idle-hours'].value = '72';
    await fire('group-settings-form', 'submit');
    assert.deepEqual(hours, { id: 'private', value: '72' });
    elements['chat-search'].value = ''; await fire('chat-search', 'input');
    elements['other-groups'].children[0].children[0].events.click(); await tick();
    assert.equal(selected.id, 'public'); assert.equal(joins, 1);
    await fire('campus-chat-choice', 'click'); assert.equal(selected, null);
    await fire('new-chat', 'click');
    elements['group-name'].value = 'My group'; elements['group-visibility'].value = 'private';
    await fire('group-visibility', 'change');
    assert.equal(elements['group-password'].required, true);
    elements['group-password'].value = 'secret'; elements['group-idle-hours'].value = '12';
    await fire('create-group-form', 'submit');
    assert.equal(created.password, 'secret'); assert.equal(created.idleHours, '12');
    assert.equal(elements['group-password'].value, ''); assert.equal(selected.id, 'new');
    controller.dispose(); assert.equal(disposed, 2);
    console.log('PASS: sidebar search/pin order, dark private rows, public joining, wrong-password prompt, request/deny/retry/approval, creator time settings, creation, password clearing and listener cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
