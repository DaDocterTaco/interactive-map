// Exercise the actual sidebar controller with DOM/service boundaries stubbed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8') + ['group-logo-create.html', 'group-logo-dialog.html'].map(name => fs.readFileSync(path.join(root, 'fragments', name), 'utf8')).join('');
const code = fs.readFileSync(path.join(root, 'groupUI.js'), 'utf8').replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '');
const appearanceCode = fs.readFileSync(path.join(root, 'groupAppearance.js'), 'utf8').replaceAll('export ', '');
const user = { uid: 'alice', displayName: 'Alice' };
const privateGroup = { id: 'private', name: 'Study', visibility: 'private', creatorId: 'alice', idleHours: 12, lastActivityAt: { toMillis: () => 0 } };
const publicGroup = { id: 'public', name: 'Football', visibility: 'public', creatorId: 'alice', idleHours: 12, lastActivityAt: { toMillis: () => 0 } };
const anotherOwner = { id: 'other-owner', name: 'Art', visibility: 'public', creatorId: 'bob' };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function element() {
    return {
        value: '', textContent: '', children: [], attributes: {}, events: {}, open: false, disabled: false,
        addEventListener(name, handler) { this.events[name] = handler; },
        setAttribute(name, value) { this.attributes[name] = value; },
        replaceChildren() { this.children = []; },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); },
        showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.events.close?.(); } },
        focus() { this.focused = true; }, reset() {}
    };
}
function setup(initial = [privateGroup, publicGroup]) {
    const elements = {};
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = element();
    elements['customize-group'] ||= element();
    let list = initial.slice(), groupsChanged, pinsChanged, requestChanged, membershipChanged;
    const calls = { selections: [], updates: [], pins: [], creates: [], deletes: [], joins: [], logos: [], requests: 0, disposed: 0, timers: 0 };
    const hooks = {};
    const groups = {
        isClosed: group => !!group.deletedAt,
        watchGroups(callback) { groupsChanged = callback; return () => calls.disposed++; },
        watchPins(uid, callback) { assert.equal(uid, user.uid); pinsChanged = callback; return () => calls.disposed++; },
        async setPinned(uid, id, pinned) { calls.pins.push({ uid, id, pinned }); pinsChanged(new Set(pinned ? [id] : [])); },
        async isMember(...args) { return hooks.isMember ? hooks.isMember(...args) : false; },
        async joinGroup(group, member, password) {
            calls.joins.push(group.id);
            if (hooks.join) return hooks.join(group, member, password);
            if (group.visibility === 'private' && password !== 'correct') throw { code: 'permission-denied' };
        },
        watchMyRequest(id, uid, callback) { requestChanged = callback; return () => {}; },
        watchMembership(id, uid, callback) { membershipChanged = callback; return () => {}; },
        async requestAccess() { calls.requests++; requestChanged({ status: 'pending' }); },
        async createGroup(member, values) { calls.creates.push(values); return { ...values, id: 'new', creatorId: member.uid }; },
        async saveGroupAppearance(id, member, appearance) { calls.logos.push({ id, uid: member.uid, appearance }); if (hooks.logo) return hooks.logo(); },
        async deleteGroup(id, member) {
            calls.deletes.push({ id, uid: member.uid });
            if (hooks.delete) return hooks.delete(id, member);
            const target = list.find(group => group.id === id);
            assert.equal(target.creatorId, member.uid, 'service receives the owner');
            list = list.map(group => group.id === id ? { ...group, deletedAt: {}, deletedBy: member.uid } : group);
            groupsChanged(list);
        }
    };
    const document = {
        getElementById: id => { assert.ok(elements[id], 'Missing ' + id); return elements[id]; }, createElement: element
    };
    const { renderAppearance, logoInitials } = new Function('document', appearanceCode + '\nreturn { renderAppearance, logoInitials };')(document);
    const editors = {};
    const mountAppearanceEditor = (prefix, options) => editors[prefix] = {
        draft: null, reset(value) { this.draft = value ? { ...value } : null; },
        value() { return this.draft || { kind: 'initials', color: 'blue', text: logoInitials(options.getName()) }; },
        updateName() {}, setDisabled(value) { this.disabled = value; }, dispose() {}
    };
    const mount = new Function('groups', 'document', 'renderAppearance', 'mountAppearanceEditor', 'setInterval', 'clearInterval', code + '\nreturn mountGroups;')(groups, document, renderAppearance, mountAppearanceEditor, () => { calls.timers++; }, () => {});
    const controller = mount({ user, onSelect: group => calls.selections.push(group), onGroupUpdated: group => calls.updates.push(group) });
    const fire = (id, event = 'click') => elements[id].events[event]({ preventDefault() {} });
    const snapshot = groups => { list = groups; groupsChanged(groups); };
    snapshot(list);
    const rows = () => [...elements['pinned-groups'].children, ...elements['other-groups'].children];
    const choice = name => { const row = rows().find(item => item.children[0].children[1].children[0].textContent === name); assert.ok(row, 'Missing group ' + name); return row.children[0]; };
    const selected = () => calls.selections.at(-1);
    return { elements, calls, hooks, editors, controller, fire, snapshot, rows, choice, selected, request: value => requestChanged(value), membership: value => membershipChanged(value), oldMembershipCallback: () => membershipChanged };
}
(async () => {
    assert.doesNotMatch(html, /group-idle-hours|settings-idle-hours|Hours without messages|Change time limit/);
    assert.match(html, /id="group-delete-name"/);
    assert.doesNotMatch(code, /changeIdleHours|expiresAt|setInterval|idleHours/);

    // Old groups remain discoverable despite elapsed legacy time limits.
    const sidebar = setup([privateGroup, publicGroup, { ...privateGroup, id: 'deleted', deletedAt: {} }]);
    assert.equal(sidebar.rows().length, 2);
    assert.equal(sidebar.calls.timers, 0);
    const privateChoice = sidebar.choice('Study');
    assert.equal(privateChoice.title, 'Study');
    assert.match(privateChoice.children[0].className, /^avatar avatar-tone-[0-4]$/);
    assert.equal(privateChoice.children[0].attributes['aria-hidden'], 'true');
    assert.equal(privateChoice.children[1].children[1].textContent, 'Private');
    assert.equal(sidebar.elements['pinned-heading'].hidden, true);
    await sidebar.rows().find(row => row.children[0] === privateChoice).children[1].events.click();
    assert.deepEqual(sidebar.calls.pins[0], { uid: 'alice', id: 'private', pinned: true });
    assert.equal(sidebar.elements['pinned-heading'].hidden, false);
    assert.equal(sidebar.elements['pinned-groups'].children[0].children[1].children[0].className, 'icon icon-pin-fill');
    sidebar.elements['chat-search'].value = 'study'; sidebar.fire('chat-search', 'input');
    assert.equal(sidebar.elements['other-groups'].children.length, 0);

    // Password and request flows remain functional.
    await sidebar.choice('Study').events.click();
    assert.equal(sidebar.elements['join-group-panel'].open, true);
    sidebar.elements['join-group-password'].value = 'wrong'; await sidebar.fire('join-group-form', 'submit');
    assert.match(sidebar.elements['join-group-status'].textContent, /Incorrect password/);
    await sidebar.fire('request-group-access');
    assert.equal(sidebar.calls.requests, 1);
    assert.equal(sidebar.elements['request-group-access'].disabled, true);
    sidebar.request({ status: 'denied' });
    assert.equal(sidebar.elements['request-group-access'].disabled, false);
    await sidebar.fire('request-group-access'); sidebar.membership(true);
    assert.equal(sidebar.selected().id, 'private');
    assert.equal(sidebar.elements['chat-panel'].attributes['data-mobile-view'], 'conversation');
    assert.equal(sidebar.elements['join-group-password'].value, '');
    assert.equal(sidebar.elements['join-group-panel'].open, false);

    // Cancelling confirmation makes no service write.
    sidebar.fire('group-settings');
    assert.equal(sidebar.elements['group-delete-name'].textContent, 'Study');
    assert.equal(sidebar.elements['cancel-group-settings'].focused, true);
    sidebar.fire('cancel-group-settings'); await sidebar.fire('group-settings-form', 'submit');
    assert.equal(sidebar.calls.deletes.length, 0);
    assert.equal(sidebar.elements['group-settings-panel'].open, false);

    // Failure retains modal and retry; busy state blocks duplicate writes and cancellation.
    sidebar.fire('group-settings');
    const deletion = deferred(); sidebar.hooks.delete = () => deletion.promise;
    const pendingDelete = sidebar.fire('group-settings-form', 'submit');
    assert.equal(sidebar.elements['save-group-settings'].disabled, true);
    assert.equal(sidebar.elements['cancel-group-settings'].disabled, true);
    assert.equal(sidebar.elements['group-settings-form'].attributes['aria-busy'], 'true');
    sidebar.fire('cancel-group-settings');
    let prevented = false;
    sidebar.elements['group-settings-panel'].events.cancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    await sidebar.fire('group-settings-form', 'submit');
    assert.equal(sidebar.calls.deletes.length, 1);
    assert.equal(sidebar.elements['group-settings-panel'].open, true);
    // The service suppresses optimistic deletion fields before acknowledgement.
    sidebar.snapshot([privateGroup, publicGroup]);
    assert.equal(sidebar.elements['group-settings-panel'].open, true);
    deletion.reject({ code: 'permission-denied' }); await pendingDelete;
    assert.match(sidebar.elements['group-settings-error'].textContent, /Group not deleted/);
    assert.equal(sidebar.elements['group-settings-panel'].open, true);
    assert.equal(sidebar.elements['save-group-settings'].disabled, false);
    assert.equal(sidebar.elements['cancel-group-settings'].disabled, false);
    delete sidebar.hooks.delete;
    await sidebar.fire('group-settings-form', 'submit');
    assert.equal(sidebar.calls.deletes.length, 2);
    assert.equal(sidebar.selected(), null);
    assert.equal(sidebar.elements['group-settings-panel'].open, false);
    assert.equal(sidebar.elements['pinned-groups'].children.length, 0);
    assert.match(sidebar.elements['groups-status'].textContent, /Study was deleted.*Campus Chat/);
    sidebar.controller.dispose(); assert.equal(sidebar.calls.disposed, 2);

    // Campus, DMs and someone else's group cannot open deletion.
    const permissions = setup([anotherOwner]);
    permissions.fire('campus-chat-choice'); permissions.fire('group-settings');
    assert.equal(permissions.elements['group-settings-panel'].open, false);
    await permissions.choice('Art').events.click(); permissions.fire('group-settings');
    assert.equal(permissions.elements['group-settings-panel'].open, false);
    permissions.controller.selectExternal({ id: 'dm:alice:bob', visibility: 'direct', creatorId: 'alice' });
    permissions.fire('group-settings'); await permissions.fire('group-settings-form', 'submit');
    assert.equal(permissions.calls.deletes.length, 0); permissions.controller.dispose();

    // Tombstones and physically missing groups both return an active member to Campus.
    for (const missing of [false, true]) {
        const remote = setup([publicGroup]);
        await remote.choice('Football').events.click(); remote.fire('group-settings');
        remote.snapshot(missing ? [] : [{ ...publicGroup, deletedAt: {}, deletedBy: 'alice' }]);
        assert.equal(remote.selected(), null);
        assert.equal(remote.rows().length, 0);
        assert.equal(remote.elements['group-settings-panel'].open, false);
        assert.match(remote.elements['groups-status'].textContent, /Football was deleted.*Campus Chat/);
        remote.controller.dispose();
    }

    // Deleted private groups close their request dialog; a queued approval cannot reopen them.
    const privateDeletion = setup([privateGroup]);
    await privateDeletion.choice('Study').events.click();
    const oldApproval = privateDeletion.oldMembershipCallback();
    privateDeletion.snapshot([{ ...privateGroup, deletedAt: {} }]); oldApproval(true);
    assert.equal(privateDeletion.elements['join-group-panel'].open, false);
    assert.equal(privateDeletion.calls.selections.length, 0);
    assert.match(privateDeletion.elements['groups-status'].textContent, /Study was deleted/);
    privateDeletion.controller.dispose();

    // Slow membership/join calls cannot replace a newer selection or enter a deleted group.
    const navigation = setup([publicGroup]);
    const memberCheck = deferred(); navigation.hooks.isMember = () => memberCheck.promise;
    const opening = navigation.choice('Football').events.click();
    navigation.fire('campus-chat-choice'); memberCheck.resolve(false); await opening;
    assert.equal(navigation.selected(), null); assert.equal(navigation.calls.joins.length, 0);
    delete navigation.hooks.isMember;
    const joining = deferred(); navigation.hooks.join = () => joining.promise;
    const openingDeleted = navigation.choice('Football').events.click(); await tick();
    navigation.snapshot([]); joining.resolve(); await openingDeleted;
    assert.equal(navigation.selected(), null);
    assert.match(navigation.elements['groups-status'].textContent, /deleted/);
    navigation.controller.dispose();

    // New groups omit lifetime settings while retaining password cleanup and selection.
    const creation = setup([]);
    creation.fire('new-chat'); creation.elements['group-name'].value = 'My group';
    creation.elements['group-visibility'].value = 'private'; creation.fire('group-visibility', 'change');
    creation.elements['group-password'].value = 'secret'; await creation.fire('create-group-form', 'submit');
    assert.deepEqual(creation.calls.creates[0], { name: 'My group', visibility: 'private', password: 'secret', appearance: { kind: 'initials', color: 'blue', text: 'MG' } });
    assert.equal(creation.selected().id, 'new');
    assert.equal(creation.elements['group-password'].value, ''); creation.controller.dispose();

    // Owner logo edits are drafts until Save; cancellation, retry and revocation are guarded.
    const logos = setup([publicGroup]);
    await logos.choice('Football').events.click(); logos.fire('customize-group');
    assert.equal(logos.elements['appearance-panel'].open, true);
    logos.editors['edit-logo'].draft = { kind: 'icon', color: 'teal', icon: 'book' };
    logos.fire('appearance-cancel'); assert.equal(logos.calls.logos.length, 0);
    logos.fire('customize-group'); assert.equal(logos.editors['edit-logo'].draft, null);
    logos.editors['edit-logo'].draft = { kind: 'icon', color: 'teal', icon: 'book' };
    const logoSave = deferred(); logos.hooks.logo = () => logoSave.promise;
    const waitingLogo = logos.fire('appearance-form', 'submit');
    logos.fire('appearance-cancel'); await logos.fire('appearance-form', 'submit');
    assert.equal(logos.calls.logos.length, 1); assert.equal(logos.elements['appearance-panel'].open, true);
    logoSave.reject(Error('Offline')); await waitingLogo;
    assert.match(logos.elements['appearance-error'].textContent, /Logo not saved/);
    assert.equal(logos.elements['appearance-save'].disabled, false);
    delete logos.hooks.logo; await logos.fire('appearance-form', 'submit');
    assert.equal(logos.calls.logos.length, 2); assert.equal(logos.elements['appearance-panel'].open, false);
    assert.deepEqual(logos.calls.updates.at(-1).appearance, { kind: 'icon', color: 'teal', icon: 'book' });
    assert.match(logos.choice('Football').children[0].className, /group-logo logo-teal/);
    logos.fire('customize-group'); logos.snapshot([{ ...publicGroup, creatorId: 'bob' }]);
    assert.equal(logos.elements['appearance-panel'].open, false);
    logos.fire('customize-group'); assert.equal(logos.elements['appearance-panel'].open, false);
    logos.snapshot([publicGroup]); logos.fire('customize-group'); logos.snapshot([{ ...publicGroup, deletedAt: {} }]);
    assert.equal(logos.elements['appearance-panel'].open, false); assert.equal(logos.selected(), null);
    logos.controller.dispose();

    // Disposed controllers cannot select a group after a late network completion.
    const disposal = setup([publicGroup]), late = deferred(); disposal.hooks.isMember = () => late.promise;
    const lateOpen = disposal.choice('Football').events.click(); disposal.controller.dispose(); late.resolve(false); await lateOpen;
    assert.equal(disposal.calls.selections.length, 0);
    console.log('PASS: persistent legacy/new groups, search/pins/private access, owner-only deletion, cancel/busy/failure/retry, cross-client removal, stale async guards, password cleanup and listener disposal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
