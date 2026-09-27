// Exercise the actual sidebar controller with DOM/service boundaries stubbed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const mainHtml = fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8');
const html = mainHtml.includes('id="explore-panel"') ? mainHtml : mainHtml + fs.readFileSync(path.join(root, 'fragments', 'explore-panel.html'), 'utf8');
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
        getAttribute(name) { return this.attributes[name] ?? null; },
        contains(node) { return this === node || this.children.some(child => child.contains?.(node)); },
        querySelectorAll() { return this.children.flatMap(child => [...(child.attributes?.['data-explore-group'] ? [child] : []), ...(child.querySelectorAll?.() || [])]); },
        replaceChildren(...children) {
            if (this.ownerDocument && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
            this.children = []; this.append(...children);
        },
        append(...children) { this.children.push(...children.flatMap(child => child.isFragment ? child.children : [child])); },
        appendChild(child) { this.children.push(child); },
        showModal() { this.open = true; }, close() { if (this.open) { this.open = false; if (this.ownerDocument) this.ownerDocument.activeElement = this.ownerDocument.body; this.events.close?.(); } },
        focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }, reset() {}
    };
}
function setup(initial = [privateGroup, publicGroup], initialMembership = true) {
    const elements = {};
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = element();
    elements['customize-group'] ||= element();
    elements['group-settings'] ||= element();
    elements['explore-groups'] ||= element();
    let list = initial.slice(), groupsChanged, groupsFailed, pinsChanged, requestChanged;
    const membershipListeners = new Map();
    const calls = { selections: [], updates: [], explores: [], pins: [], creates: [], deletes: [], joins: [], logos: [], requests: 0, disposed: 0, memberStops: 0, timers: 0 };
    const hooks = {};
    const groups = {
        isClosed: group => !!group.deletedAt,
        watchGroups(callback, onError) { groupsChanged = callback; groupsFailed = onError; return () => calls.disposed++; },
        watchPins(uid, callback) { assert.equal(uid, user.uid); pinsChanged = callback; return () => calls.disposed++; },
        async setPinned(uid, id, pinned) { calls.pins.push({ uid, id, pinned }); pinsChanged(new Set(pinned ? [id] : [])); },
        async isMember(...args) { return hooks.isMember ? hooks.isMember(...args) : false; },
        async joinGroup(group, member, password) {
            calls.joins.push(group.id);
            if (hooks.join) return hooks.join(group, member, password);
            if (group.visibility === 'private' && password !== 'correct') throw { code: 'permission-denied' };
        },
        watchMyRequest(id, uid, callback) { requestChanged = callback; return () => {}; },
        watchMembership(id, uid, callback, onError) {
            const listener = { callback, onError }; membershipListeners.set(id, listener);
            if (initialMembership !== null) callback(initialMembership);
            return () => { calls.memberStops++; if (membershipListeners.get(id) === listener) membershipListeners.delete(id); };
        },
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
        getElementById: id => { assert.ok(elements[id], 'Missing ' + id); return elements[id]; },
        createElement: () => ({ ...element(), ownerDocument: document }),
        createDocumentFragment: () => ({ ...element(), isFragment: true })
    };
    document.body = element(); document.activeElement = document.body;
    for (const value of Object.values(elements)) value.ownerDocument = document;
    const { renderAppearance, logoInitials } = new Function('document', appearanceCode + '\nreturn { renderAppearance, logoInitials };')(document);
    const editors = {};
    const mountAppearanceEditor = (prefix, options) => editors[prefix] = {
        draft: null, reset(value) { this.draft = value ? { ...value } : null; },
        value() { return this.draft || { kind: 'initials', color: 'blue', text: logoInitials(options.getName()) }; },
        updateName() {}, setDisabled(value) { this.disabled = value; }, dispose() {}
    };
    const mount = new Function('groups', 'document', 'renderAppearance', 'mountAppearanceEditor', 'setInterval', 'clearInterval', code + '\nreturn mountGroups;')(groups, document, renderAppearance, mountAppearanceEditor, () => { calls.timers++; }, () => {});
    const controller = mount({ user, onSelect: group => calls.selections.push(group), onGroupUpdated: group => calls.updates.push(group), onExplore: open => calls.explores.push(open) });
    const fire = (id, event = 'click') => elements[id].events[event]({ preventDefault() {} });
    const snapshot = groups => { list = groups; groupsChanged(groups); };
    snapshot(list);
    const rows = () => [...elements['pinned-groups'].children, ...elements['other-groups'].children];
    const choice = name => { const row = rows().find(item => item.children[0].children[1].children[0].textContent === name); assert.ok(row, 'Missing group ' + name); return row.children[0]; };
    const selected = () => calls.selections.at(-1);
    const discover = name => {
        const card = elements['explore-results'].children.find(item => item.children[0].children[1].textContent === name);
        assert.ok(card, 'Missing discovery card ' + name); return card.children[2].children[1];
    };
    return { elements, calls, hooks, editors, controller, fire, snapshot, rows, choice, discover, selected, document,
        groupError: error => groupsFailed(error), pinSnapshot: value => pinsChanged(value), request: value => requestChanged(value),
        membership: (value, id = 'private') => membershipListeners.get(id).callback(value),
        memberError: (error, id) => membershipListeners.get(id).onError(error),
        oldMembershipCallback: (id = 'private') => membershipListeners.get(id).callback,
        membershipListeners };
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
    sidebar.membership(false); sidebar.fire('explore-groups');
    assert.equal(sidebar.rows().length, 0, 'Unjoined pinned private group is removed from personal list');
    await sidebar.discover('Study').events.click();
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
    const privateDeletion = setup([privateGroup], false);
    await privateDeletion.discover('Study').events.click();
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

    // Discovery waits for confirmed membership, keeps pins separate, filters
    // public/private groups, and tolerates listener errors and stale retries.
    const discovery = setup([privateGroup, publicGroup, anotherOwner], null);
    assert.equal(discovery.elements['explore-groups'].disabled, false, 'Explore becomes available after authenticated mount');
    assert.equal(discovery.rows().length, 0);
    assert.match(discovery.elements['groups-empty'].textContent, /Loading/);
    assert.equal(discovery.discover('Football').disabled, true);
    discovery.pinSnapshot(new Set(['private']));
    discovery.membership(false, 'private'); discovery.membership(false, 'public'); discovery.membership(false, 'other-owner');
    assert.equal(discovery.rows().length, 0, 'An unjoined pinned group stays in discovery');
    assert.equal(discovery.discover('Study').textContent, 'Request to join');
    assert.equal(discovery.discover('Football').textContent, 'Join group');
    discovery.fire('explore-groups'); assert.equal(discovery.controller.isExploring(), true);
    assert.equal(discovery.elements['explore-search'].focused, true);
    discovery.elements['explore-filter'].value = 'private'; discovery.fire('explore-filter', 'change');
    assert.equal(discovery.elements['explore-results'].children.length, 1);
    discovery.elements['explore-search'].value = 'STUD'; discovery.fire('explore-search', 'input');
    assert.equal(discovery.elements['explore-results'].children.length, 1);
    discovery.elements['explore-search'].value = '<missing>'; discovery.fire('explore-search', 'input');
    assert.equal(discovery.elements['explore-empty'].hidden, false);
    assert.match(discovery.elements['explore-empty'].textContent, /No groups match/);
    discovery.elements['explore-search'].value = ''; discovery.elements['explore-filter'].value = 'all'; discovery.fire('explore-filter', 'change');
    const staleMembership = discovery.oldMembershipCallback('public');
    discovery.memberError(Error('Offline'), 'public');
    assert.equal(discovery.discover('Football').textContent, 'Retry');
    assert.equal(discovery.elements['explore-retry'].hidden, false);
    discovery.discover('Football').events.click();
    assert.equal(discovery.discover('Football').textContent, 'Checking…');
    staleMembership(true); assert.equal(discovery.rows().length, 0, 'A superseded listener cannot create membership');
    discovery.membership(false, 'public');
    const confirmed = deferred(); discovery.hooks.join = () => confirmed.promise;
    const waitingJoin = discovery.discover('Football').events.click(); await tick();
    assert.equal(discovery.discover('Football').textContent, 'Opening…');
    assert.equal(discovery.rows().length, 0, 'Joining is not optimistic');
    confirmed.resolve(); await waitingJoin;
    assert.equal(discovery.rows().length, 1); assert.equal(discovery.selected().id, 'public');
    assert.equal(discovery.controller.isExploring(), false);
    assert.equal(discovery.discover('Football').textContent, 'Open chat');
    assert.deepEqual(discovery.calls.explores, [true, false]);
    discovery.membership(true, 'private');
    assert.equal(discovery.elements['pinned-groups'].children.length, 1, 'An external approval joins a pinned group');
    discovery.membership(false, 'public');
    assert.equal(discovery.selected(), null, 'Revoked membership returns to Campus');
    discovery.fire('explore-groups'); discovery.fire('close-explore');
    assert.equal(discovery.elements['explore-groups'].focused, true);
    discovery.groupError(Error('Connection lost'));
    assert.match(discovery.elements['explore-status'].textContent, /Connection lost/);
    discovery.fire('explore-retry'); discovery.snapshot([privateGroup, publicGroup, anotherOwner]);
    assert.equal(discovery.elements['explore-retry'].hidden, true);
    const beforeRemoval = discovery.calls.memberStops;
    discovery.snapshot([publicGroup, anotherOwner]);
    assert.equal(discovery.calls.memberStops, beforeRemoval + 1);
    const lateMembership = discovery.oldMembershipCallback('public');
    discovery.controller.dispose(); lateMembership(true);
    assert.equal(discovery.elements['explore-groups'].disabled, true, 'Explore is disabled after session disposal');
    assert.equal(discovery.membershipListeners.size, 0);
    assert.equal(discovery.calls.selections.at(-1), null);

    // Returning from discovery cancels pending navigation, without pretending
    // an already submitted join was cancelled on the server.
    const returnFromExplore = setup([publicGroup], false), pendingMembership = deferred();
    returnFromExplore.hooks.isMember = () => pendingMembership.promise;
    returnFromExplore.fire('explore-groups');
    const pendingOpen = returnFromExplore.discover('Football').events.click();
    returnFromExplore.fire('close-explore'); pendingMembership.resolve(false); await pendingOpen;
    assert.equal(returnFromExplore.calls.selections.length, 0);
    assert.equal(returnFromExplore.calls.joins.length, 0);
    returnFromExplore.controller.dispose();

    // Keyboard focus returns to the current card after loading nodes are
    // replaced, failed joins, private cancellation, and membership retries.
    const keyboard = setup([publicGroup, privateGroup], null);
    keyboard.membership(false, 'public'); keyboard.membership(false, 'private'); keyboard.fire('explore-groups');
    keyboard.hooks.join = async () => { throw Error('Connection lost'); };
    keyboard.discover('Football').focus(); await keyboard.discover('Football').events.click();
    assert.equal(keyboard.document.activeElement, keyboard.discover('Football'));
    keyboard.discover('Study').focus(); await keyboard.discover('Study').events.click();
    assert.equal(keyboard.elements['join-group-panel'].open, true);
    keyboard.fire('cancel-join-group');
    assert.equal(keyboard.document.activeElement, keyboard.discover('Study'));
    keyboard.memberError(Error('Offline'), 'public'); keyboard.discover('Football').focus(); keyboard.discover('Football').events.click();
    assert.equal(keyboard.discover('Football').textContent, 'Checking…');
    keyboard.membership(false, 'public');
    assert.equal(keyboard.document.activeElement, keyboard.discover('Football'));
    const failingJoin = deferred(); keyboard.hooks.join = () => failingJoin.promise;
    keyboard.discover('Football').focus(); const waitingFailure = keyboard.discover('Football').events.click(); await tick();
    keyboard.elements['explore-search'].focus(); failingJoin.reject(Error('Offline')); await waitingFailure;
    assert.equal(keyboard.document.activeElement, keyboard.elements['explore-search'], 'Late errors do not steal a new focus target');
    keyboard.controller.dispose();

    // Disposed controllers cannot select a group after a late network completion.
    const disposal = setup([publicGroup]), late = deferred(); disposal.hooks.isMember = () => late.promise;
    const lateOpen = disposal.choice('Football').events.click(); disposal.controller.dispose(); late.resolve(false); await lateOpen;
    assert.equal(disposal.calls.selections.length, 0);
    console.log('PASS: joined-only groups, discovery/search/filter, confirmed joins, membership retry/revocation/disposal, private approval, persistent groups, owner logo/deletion, and stale navigation guards.');
})().catch(error => { console.error(error); process.exitCode = 1; });
