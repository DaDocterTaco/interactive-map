const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'chatInfoUI.js'), 'utf8').replace(/^import[^\n]+\n/gm, '').replace('export function mountChatInfo', 'function mountChatInfo');
const fragment = fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
    const elements = new Map();
    let document;
    function element(id = '') {
        const handlers = new Map();
        return {
            id, textContent: '', className: '', children: [], attrs: {}, hidden: false, disabled: false, open: false,
            setAttribute(key, value) { this.attrs[key] = value; },
            appendChild(child) { this.children.push(child); },
            replaceChildren(...children) { this.children = children; },
            focus() { document.activeElement = this; },
            addEventListener(type, callback, options = {}) { const list = handlers.get(type) || []; list.push({ callback, options }); handlers.set(type, list); },
            emit(type) {
                const event = { currentTarget: this, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
                const list = [...(handlers.get(type) || [])].sort((a, b) => Boolean(b.options.capture) - Boolean(a.options.capture));
                for (const { callback, options } of list) { if (options.signal?.aborted) continue; callback(event); if (event.stopped) break; }
                return event;
            },
            showModal() { this.open = true; },
            close() { if (this.open) { this.open = false; this.emit('close'); } }
        };
    }
    for (const [, id] of fragment.matchAll(/id="([^"]+)"/g)) elements.set(id, element(id));
    for (const id of ['open-chat-info', 'chat-info-menu', 'chat-options', 'chat-more', 'members-panel', 'appearance-panel', 'group-settings-panel']) elements.set(id, element(id));
    document = { activeElement: null, getElementById: id => elements.get(id), createElement: () => element() };
    const user = { uid: 'owner', displayName: 'Owner' }, watches = [], profileCalls = [], profiles = new Map();
    const people = {
        getProfile(uid) { profileCalls.push(uid); return profiles.get(uid) || Promise.resolve({ uid, displayName: `Person ${uid}` }); },
        watchMembers(id, callback, error) { const watch = { id, callback, error, stopped: false }; watches.push(watch); return () => { watch.stopped = true; }; }
    };
    const renderAppearance = (avatar, group) => { avatar.textContent = group.appearance?.text || group.name; avatar.className = 'avatar'; };
    const initials = name => String(name).slice(0, 2).toUpperCase();
    const mount = new Function('people', 'renderAppearance', 'logoInitials', 'document', code + '\nreturn mountChatInfo;')(people, renderAppearance, initials, document);
    const ui = mount({ user });
    return { ui, user, el: id => elements.get(id), document, watches, profiles, profileCalls };
}
const ownGroup = { id: 'study', name: 'Study group', visibility: 'public', creatorId: 'owner' };

test('header and menu open chat info; Campus and DMs have no group actions', () => {
    const s = setup();
    s.el('open-chat-info').emit('click');
    assert.equal(s.el('chat-info-panel').open, true);
    assert.equal(s.el('show-members').hidden, true);
    assert.equal(s.el('chat-info-settings').hidden, true);
    assert.equal(s.watches.length, 0);
    assert.equal(s.el('chat-options').hidden, true);
    assert.equal(s.el('chat-more').attrs['aria-expanded'], 'false');
    s.el('close-chat-info').emit('click');
    assert.equal(s.document.activeElement.id, 'open-chat-info');
    s.ui.setConversation({ id: 'dm:owner:friend', name: '<A friend>', visibility: 'direct' });
    s.el('chat-info-menu').emit('click');
    assert.equal(s.el('chat-info-title').textContent, 'Contact info');
    assert.equal(s.el('chat-info-name').textContent, '<A friend>');
    assert.equal(s.el('show-members').hidden, true);
    assert.equal(s.el('customize-group').hidden, true);
    assert.equal(s.el('group-settings').hidden, true);
    assert.equal(s.watches.length, 0);
    s.el('close-chat-info').emit('click');
    assert.equal(s.document.activeElement.id, 'open-chat-info', 'closing the menu first must not return focus into a hidden menu');
    s.ui.dispose();
});

test('owner settings and nested actions keep a predictable back and focus path', () => {
    const s = setup();
    s.ui.setConversation(ownGroup); s.el('open-chat-info').emit('click');
    assert.equal(s.el('show-members').hidden, false);
    s.el('show-members').emit('click'); s.el('members-panel').showModal(); s.el('members-panel').close();
    assert.equal(s.document.activeElement.id, 'show-members');
    s.el('chat-info-settings').emit('click');
    assert.equal(s.el('chat-info-title').textContent, 'Chat settings');
    assert.equal(s.el('chat-info-overview').hidden, true);
    assert.equal(s.document.activeElement.id, 'chat-info-back');
    assert.equal(s.el('customize-group').hidden, false);
    assert.equal(s.el('group-settings').hidden, false);
    assert.equal(s.el('chat-info-owner').textContent, 'Owner (you)');
    s.el('customize-group').emit('click'); s.el('appearance-panel').showModal(); s.el('appearance-panel').close();
    assert.equal(s.el('chat-info-panel').open, true);
    assert.equal(s.document.activeElement.id, 'customize-group');
    s.el('chat-info-back').emit('click');
    assert.equal(s.el('chat-info-settings-page').hidden, true);
    assert.equal(s.document.activeElement.id, 'chat-info-settings');
    s.ui.dispose();
});

test('ordinary members can inspect settings but cannot invoke owner actions', async () => {
    const s = setup();
    let customizations = 0, deletions = 0;
    s.el('customize-group').addEventListener('click', () => customizations++);
    s.el('group-settings').addEventListener('click', () => deletions++);
    s.ui.setConversation({ ...ownGroup, creatorId: 'another-owner', visibility: 'private' });
    s.el('open-chat-info').emit('click'); s.el('chat-info-settings').emit('click'); await tick();
    assert.equal(s.el('chat-info-settings-page').hidden, false);
    assert.equal(s.el('chat-info-access').textContent, 'Password or member approval');
    assert.equal(s.el('chat-info-owner').textContent, 'Person another-owner');
    assert.equal(s.el('chat-info-owner-note').hidden, false);
    assert.equal(s.el('customize-group').disabled, true);
    assert.equal(s.el('group-settings').hidden, true);
    assert.equal(s.el('customize-group').emit('click').defaultPrevented, true);
    s.el('group-settings').emit('click');
    assert.equal(customizations + deletions, 0);
    s.ui.dispose();
});

test('live updates refresh metadata without closing settings or replacing its member listener', async () => {
    const s = setup();
    s.ui.setConversation(ownGroup); s.el('open-chat-info').emit('click'); s.el('chat-info-settings').emit('click');
    await s.watches[0].callback(['owner', 'b', 'b', 'c', 'd']);
    assert.equal(s.el('chat-info-member-count').textContent, '4 members');
    assert.equal(s.el('chat-info-member-preview').children.length, 3);
    assert.deepEqual(s.profileCalls, ['b', 'c'], 'preview reads only the three visible profiles and uses the current profile locally');
    s.ui.refresh({ ...ownGroup, name: 'Renamed study', appearance: { text: 'RS' } });
    assert.equal(s.el('chat-info-panel').open, true);
    assert.equal(s.el('chat-info-title').textContent, 'Chat settings');
    assert.equal(s.el('chat-info-name').textContent, 'Renamed study');
    assert.equal(s.el('chat-info-avatar').textContent, 'RS');
    assert.equal(s.watches.length, 1);
    assert.equal(s.watches[0].stopped, false);
    s.ui.refresh({ ...ownGroup, creatorId: 'someone-else' });
    assert.equal(s.el('customize-group').hidden, true, 'live loss of ownership immediately removes mutation controls');
    s.ui.dispose();
});

test('stale member and owner reads cannot overwrite a new conversation', async () => {
    const s = setup();
    let resolveOwner, resolveMember;
    s.profiles.set('old-owner', new Promise(resolve => { resolveOwner = resolve; }));
    s.profiles.set('old-member', new Promise(resolve => { resolveMember = resolve; }));
    s.ui.setConversation({ ...ownGroup, creatorId: 'old-owner' }); s.el('open-chat-info').emit('click');
    const pending = s.watches[0].callback(['old-member']);
    s.ui.setConversation({ id: 'new', name: 'New group', visibility: 'public', creatorId: 'owner' });
    assert.equal(s.el('chat-info-panel').open, false);
    assert.equal(s.watches[0].stopped, true);
    s.el('open-chat-info').emit('click'); await s.watches[1].callback(['owner']);
    resolveOwner({ uid: 'old-owner', displayName: 'Stale owner' }); resolveMember({ uid: 'old-member', displayName: 'Stale member' });
    await pending; await tick(); s.watches[0].error(new Error('Old failure'));
    assert.equal(s.el('chat-info-name').textContent, 'New group');
    assert.equal(s.el('chat-info-owner').textContent, 'Owner (you)');
    assert.equal(s.el('chat-info-member-count').textContent, '1 member');
    assert.equal(s.el('chat-info-member-preview').children[0].title, 'Owner');
    assert.equal(s.el('chat-info-status').textContent, '');
    s.ui.dispose();
});

test('newer member snapshots win and close/dispose revoke pending work', async () => {
    const s = setup();
    let resolveMember;
    s.profiles.set('slow', new Promise(resolve => { resolveMember = resolve; }));
    s.ui.setConversation(ownGroup); s.el('open-chat-info').emit('click');
    const pending = s.watches[0].callback(['slow']);
    await s.watches[0].callback(['owner']);
    resolveMember({ uid: 'slow', displayName: 'Slow' }); await pending;
    assert.equal(s.el('chat-info-member-preview').children[0].title, 'Owner');
    s.el('close-chat-info').emit('click');
    assert.equal(s.watches[0].stopped, true);
    s.el('open-chat-info').emit('click');
    assert.equal(s.watches.length, 2);
    s.ui.dispose();
    assert.equal(s.watches[1].stopped, true);
    assert.equal(s.el('chat-info-panel').open, false);
    s.el('open-chat-info').emit('click');
    assert.equal(s.el('chat-info-panel').open, false);
});

test('deletion closes info and late child-close events cannot resurrect the previous view', () => {
    const s = setup();
    s.ui.setConversation(ownGroup); s.el('open-chat-info').emit('click'); s.el('chat-info-settings').emit('click');
    s.el('group-settings').emit('click'); s.el('group-settings-panel').showModal();
    s.ui.refresh({ ...ownGroup, deletedAt: { seconds: 1234 } });
    assert.equal(s.el('chat-info-panel').open, false);
    assert.equal(s.watches[0].stopped, true);
    s.el('group-settings-panel').close(); s.el('open-chat-info').emit('click');
    assert.equal(s.el('chat-info-panel').open, false);
    assert.equal(s.el('group-settings').hidden, true);
    s.ui.dispose();
});
