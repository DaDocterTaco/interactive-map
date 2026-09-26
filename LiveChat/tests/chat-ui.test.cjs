// Run the production chat controller against a small DOM model and injected
// services. These tests never connect to Firebase or modify shared chat data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'chat.js'), 'utf8')
    .replace(/import\("\.\/([^"?]+)(?:\?[^"]*)?"\)/g, (_, file) => `loadModule(${JSON.stringify(file)})`);

function event(type, target, extra = {}) {
    return { type, target, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; }, ...extra };
}
function createApp({ stored = {}, dark = false, reduced = false, mobile = false, displayName = 'Alice' } = {}) {
    const preferences = new Map(Object.entries(stored));
    const timers = new Map();
    let timerId = 0, document;
    class Element {
        constructor(tag = 'div') {
            Object.assign(this, { tagName: tag, children: [], parentNode: null, listeners: new Map(), attributes: {}, dataset: {},
                className: '', _text: '', id: '', hidden: false, disabled: false, value: '', open: false, scrollTop: 0, clientHeight: 600 });
            const styles = new Map();
            this.style = { setProperty: (key, value) => styles.set(key, value), getPropertyValue: key => styles.get(key) || '' };
            this.capturedPointers = new Set();
            this.classList = {
                contains: value => this.className.split(/\s+/).includes(value),
                add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
                remove: (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); },
                toggle: (value, on) => on ? this.classList.add(value) : this.classList.remove(value)
            };
        }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
        set textContent(value) { this.replaceChildren(); this._text = String(value); }
        get firstChild() { return this.children[0] || null; }
        get firstElementChild() { return this.firstChild; }
        get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
        get isConnected() { return this === document.documentElement || !!this.parentNode?.isConnected; }
        get layoutHeight() { return this.measureHeight?.() ?? 80; }
        get scrollHeight() { return this.children.reduce((height, child) => height + child.layoutHeight, 0); }
        append(...children) { children.forEach(child => this.appendChild(child)); }
        appendChild(child) { return this.insertBefore(child, null); }
        insertBefore(child, next) {
            child.remove();
            const index = next ? this.children.indexOf(next) : -1;
            if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
            child.parentNode = this; return child;
        }
        replaceChildren(...children) {
            this._text = ''; this.children.forEach(child => { child.parentNode = null; });
            this.children = []; this.append(...children);
        }
        remove() {
            if (!this.parentNode) return;
            const parent = this.parentNode, index = parent.children.indexOf(this);
            if (index !== -1) parent.children.splice(index, 1);
            this.parentNode = null;
        }
        after(child) { this.parentNode?.insertBefore(child, this.nextSibling); }
        setAttribute(name, value) {
            this.attributes[name] = String(value);
            if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
        }
        getAttribute(name) { return this.attributes[name] ?? null; }
        removeAttribute(name) { delete this.attributes[name]; }
        addEventListener(name, handler, options = {}) {
            if (!this.listeners.has(name)) this.listeners.set(name, []);
            this.listeners.get(name).push({ handler, once: options.once });
        }
        removeEventListener(name, handler) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item.handler !== handler)); }
        dispatchEvent(value) {
            const results = [];
            for (const item of [...(this.listeners.get(value.type) || [])]) {
                if (item.once) this.removeEventListener(value.type, item.handler);
                results.push(item.handler(value));
            }
            this.lastDispatch = Promise.all(results); return !value.defaultPrevented;
        }
        async fire(type, extra = {}) {
            const value = event(type, this, extra); this.dispatchEvent(value); await this.lastDispatch; return value;
        }
        contains(child) { return child === this || this.children.some(item => item.contains(child)); }
        querySelector(selector) {
            return descendants(this).find(child => selector.startsWith('[data-')
                ? child.getAttribute(selector.slice(1, -1)) !== null
                : selector.startsWith('button') ? child.tagName === 'button' && !child.hidden && !child.disabled
                : selector.startsWith('.') ? child.classList.contains(selector.slice(1)) : false) || null;
        }
        closest(selector) { return selector.split(',').some(part => part.trim() === this.tagName) ? this : this.parentNode?.closest(selector) || null; }
        setPointerCapture(id) { this.capturedPointers.add(id); }
        hasPointerCapture(id) { return this.capturedPointers.has(id); }
        releasePointerCapture(id) { this.capturedPointers.delete(id); }
        focus() { document.activeElement = this; }
        showModal() { this.open = true; }
        close() { if (!this.open) return; this.open = false; this.dispatchEvent(event('close', this)); }
        scrollTo({ top, behavior }) { this.scrollTop = top; this.lastScrollBehavior = behavior; }
        getBoundingClientRect() {
            const index = this.parentNode?.children.indexOf(this) || 0;
            const precedingHeight = this.parentNode?.children.slice(0, index).reduce((height, child) => height + child.layoutHeight, 0) || 0;
            const top = this.id === 'message-list' ? 0 : precedingHeight - (this.parentNode?.scrollTop || 0);
            return { top, bottom: top + this.layoutHeight };
        }
        setCustomValidity(message) { this.validationMessage = message; }
        reportValidity() { return !this.validationMessage; }
        reset() { this.value = ''; }
        requestSubmit() { return this.fire('submit'); }
    }
    const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
    const documentEvents = new Element('document'), documentRoot = new Element('html');
    document = { documentElement: documentRoot, activeElement: null, createElement: tag => new Element(tag),
        getElementById: id => descendants(documentRoot).find(element => element.id === id) || null,
        addEventListener: (...args) => documentEvents.addEventListener(...args) };
    for (const [, tag, attributes, id] of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
        const element = new Element(tag); element.id = id;
        element.className = attributes.match(/class="([^"]*)"/)?.[1] || '';
        element.hidden = /\bhidden(?:\s|$)/.test(attributes); element.disabled = /\bdisabled(?:\s|$)/.test(attributes);
        for (const [, key, value] of attributes.matchAll(/((?:aria-|data-)[\w-]+)="([^"]*)"/g)) element.setAttribute(key, value);
        documentRoot.appendChild(element);
    }
    const get = id => { const element = document.getElementById(id); assert.ok(element, `Missing HTML element ${id}`); return element; };
    // Only menu/theme child nesting affects the behaviors exercised here.
    for (const id of ['clear-chat', 'group-settings', 'show-members', 'toggle-message-times']) get('chat-options').append(get(id));
    const themeLabel = new Element('span'); themeLabel.setAttribute('data-theme-label', ''); get('theme-toggle').append(themeLabel);
    const timesLabel = new Element('span'); timesLabel.setAttribute('data-message-times-label', ''); get('toggle-message-times').append(timesLabel);
    const media = {
        '(prefers-reduced-motion: reduce)': { matches: reduced, addEventListener() {} },
        '(prefers-color-scheme: dark)': { matches: dark, addEventListener(type, fn) { this.onChange = fn; } },
        '(max-width: 700px)': { matches: mobile, addEventListener() {} }
    };
    const state = { sends: [], clears: 0, removals: [], messageStops: 0, roleStops: 0, forumDisposals: 0,
        forumsActive: false, failSend: null, failClear: false, sendWait: null };
    const user = { uid: 'alice', displayName };
    const modules = {
        'chatAuth.js': { restoreUser: async () => user, watchUser(callback) { state.authChanged = callback; } },
        'chatService.js': {
            watchModerator(uid, callback, error) { state.role = callback; state.roleError = error; return () => state.roleStops++; },
            watchMessages(callback, error, groupId) { state.receive = callback; state.listenError = error; state.watchedGroup = groupId; return () => state.messageStops++; },
            async sendMessage(sender, text, groupId) {
                if (state.failSend) throw { code: state.failSend };
                if (state.sendWait) await state.sendWait;
                state.sends.push({ sender, text, groupId }); return { id: 'saved' };
            },
            async removeMessage(sender, id, reason, groupId) { state.removals.push({ sender, id, reason, groupId }); },
            async clearMessages(sender, reason, progress) {
                state.clears++; state.clearReason = reason;
                if (state.failClear) throw Error('Connection interrupted');
                progress(3, 3); state.receive([], false); return 3;
            }
        },
        'groups.js': { isClosed: group => !!group.deletedAt,
            watchRequests(id, callback) { state.requests = callback; return () => {}; } },
        'groupUI.js': { mountGroups({ onSelect, onGroupUpdated }) { state.selectGroup = onSelect; state.groupUpdated = onGroupUpdated; return { dispose() {}, selectExternal: onSelect }; } },
        'people.js': { saveProfile: async () => {} },
        'peopleUI.js': { mountPeople: () => ({ setConversation() {}, dispose() {} }) },
        'forums/forumUI.js': { mountForums: () => ({ setActive(value) { state.forumsActive = value; }, dispose() { state.forumDisposals++; } }) }
    };
    vm.runInNewContext(code, { document, Date, console,
        window: { matchMedia: query => { assert.ok(media[query], query); return media[query]; } },
        localStorage: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
        location: { protocol: 'http:' }, loadModule: async file => { assert.ok(modules[file], file); return modules[file]; },
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
    });
    return { get, state, media, preferences, document, documentEvents,
        fire: (id, type = 'click', extra) => get(id).fire(type, extra), open: () => get('open-chat').fire('click'),
        rows: () => get('message-list').children.filter(child => child.classList.contains('message-row')),
        row: id => get('message-list').children.find(child => child.dataset.messageId === id),
        flushTimers(maxDelay = 300) { for (const [id, timer] of [...timers]) if (timer.delay <= maxDelay) { timers.delete(id); timer.fn(); } },
        async decide(reason = 'Harmful content') { get('moderation-reason').value = reason; await get('moderation-form').fire('submit'); }
    };
}
const message = (id = 'message-1', senderId = 'bob', name = 'Bob', text = '<b>Hello</b>', pending = false) => ({
    id, senderId, name, text, pending, createdAt: { toDate: () => new Date('2026-09-26T14:42:00') }
});

test('initial history stays quiet; keyed rows retain identity and only new messages animate', async () => {
    const app = createApp(); await app.open();
    assert.equal(app.get('send-message').disabled, true); app.state.receive([], true);
    const initial = [message(), message('own', 'alice', 'Alice', 'Hi')]; app.state.receive(initial, false);
    const original = app.row('message-1');
    assert.equal(original.querySelector('.message-bubble').textContent, '<b>Hello</b>');
    assert.equal(original.querySelector('.message-bubble').children.length, 0, 'message text must not become HTML');
    assert.equal(original.classList.contains('message-enter'), false); assert.equal(app.get('message-announcer').textContent, '');
    assert.equal(app.row('own').querySelector('.message-name').textContent, 'You');
    assert.equal(app.row('own').querySelector('.message-delivery').textContent, 'Sent');
    const next = [...initial, message('new', 'carol', 'Carol', 'New message')]; app.state.receive(next, false);
    assert.equal(app.row('message-1'), original); assert.equal(app.row('new').classList.contains('message-enter'), true);
    assert.match(app.get('message-announcer').textContent, /Carol: New message/);
    await app.row('new').fire('animationend'); app.state.receive(next, false);
    assert.equal(app.row('new').classList.contains('message-enter'), false, 'metadata updates must not replay entrance');
    app.state.receive([{ ...initial[1], pending: true }], false);
    assert.equal(app.rows().length, 1); assert.equal(app.row('own').querySelector('.message-delivery').textContent, 'Sending…');
    assert.equal(app.get('message-list').children.filter(child => child.classList.contains('message-date')).length, 1);
});

test('moderation requires a live role, noncached messages, and explicit recorded confirmation', async () => {
    const app = createApp(); await app.open(); app.state.receive([message()], false);
    await app.fire('clear-chat'); assert.equal(app.state.clears, 0); assert.equal(app.get('clear-chat').hidden, true);
    assert.equal(app.row('message-1').querySelector('.remove-message').hidden, true); app.state.role(true);
    const removing = app.row('message-1').querySelector('.remove-message').fire('click');
    assert.equal(app.get('moderation-panel').open, true); await app.decide('  ');
    assert.equal(app.get('moderation-panel').open, true); assert.match(app.get('moderation-error').textContent, /reason/);
    await app.decide(' Harmful content '); await removing;
    assert.equal(app.state.removals.length, 1); assert.equal(app.state.removals[0].reason, 'Harmful content');
    app.state.receive([message()], true); assert.equal(app.get('clear-chat').disabled, true);
    await app.fire('clear-chat'); assert.equal(app.state.clears, 0);
    app.state.receive([message()], false); const revoked = app.fire('clear-chat');
    app.state.role(false); await app.decide(); await revoked;
    assert.equal(app.state.clears, 0, 'revocation during confirmation must stop the clear'); assert.equal(app.get('clear-chat').hidden, true);
});

test('cancelled clear does nothing; failed clear retries; successful clear displays an empty state', async () => {
    const app = createApp(); await app.open(); app.state.receive([message()], false); app.state.role(true);
    const cancelled = app.fire('clear-chat'); await app.fire('moderation-cancel'); await cancelled; assert.equal(app.state.clears, 0);
    app.state.failClear = true; const failed = app.fire('clear-chat'); await app.decide(); await failed;
    assert.match(app.get('message-status').textContent, /did not finish/); assert.equal(app.get('clear-chat').disabled, false);
    app.state.failClear = false; const cleared = app.fire('clear-chat'); await app.decide(); await cleared;
    assert.equal(app.state.clears, 2); assert.equal(app.rows().length, 0);
    assert.match(app.get('message-list').textContent, /Start the conversation/); assert.match(app.get('message-status').textContent, /3 messages cleared/);
});

test('denied sends retain drafts; explicit retry succeeds without duplicating snapshot messages', async () => {
    const app = createApp(); await app.open(); app.state.receive([message()], false);
    app.get('message-input').value = 'Hello'; app.state.failSend = 'permission-denied'; await app.fire('message-form', 'submit');
    assert.equal(app.get('message-input').value, 'Hello'); assert.equal(app.get('message-status').dataset.state, 'error');
    assert.match(app.get('message-status').textContent, /not sent.*draft is kept/); assert.equal(app.get('message-retry').hidden, false);
    app.state.failSend = null; await app.fire('message-retry');
    assert.equal(app.state.sends.length, 1); assert.equal(app.get('message-input').value, '');
    assert.equal(app.get('message-status').textContent, 'Sent'); assert.equal(app.get('message-retry').hidden, true);
    assert.equal(app.rows().length, 1, 'only snapshots add message rows');
});

test('pending sends show feedback and reject duplicate submissions', async () => {
    const app = createApp(); await app.open(); app.state.receive([], false);
    let finish; app.state.sendWait = new Promise(resolve => { finish = resolve; }); app.get('message-input').value = 'Hello';
    const sending = app.fire('message-form', 'submit');
    assert.equal(app.get('send-message').disabled, true); assert.equal(app.get('send-message').textContent, 'Sending…');
    assert.equal(app.get('message-form').getAttribute('aria-busy'), 'true');
    await app.fire('message-form', 'submit'); finish(); await sending;
    assert.equal(app.state.sends.length, 1); assert.equal(app.get('message-form').getAttribute('aria-busy'), 'false');
});

test('DMs expose no moderation; conversation switching keeps drafts and routes group sends', async () => {
    const app = createApp(); await app.open(); app.state.receive([message()], false); app.state.role(true);
    app.get('message-input').value = 'Campus draft';
    app.state.selectGroup({ id: 'dm:alice:bob', name: 'Bob', visibility: 'direct' }); app.state.receive([message()], false);
    assert.equal(app.get('clear-chat').hidden, true); assert.equal(app.row('message-1').querySelector('.remove-message').hidden, true);
    assert.match(app.get('chat-subtitle').textContent, /Just the two of you/);
    app.state.selectGroup(null); assert.equal(app.get('message-input').value, 'Campus draft');
    const group = { id: 'study', name: 'Study group', visibility: 'private', creatorId: 'alice', idleHours: 12, lastActivityAt: { toMillis: () => 0 } };
    app.state.selectGroup(group); app.state.receive([message()], false);
    assert.equal(app.get('group-settings').hidden, false); assert.equal(app.get('conversation-avatar').textContent, 'SG');
    assert.equal(app.get('group-expiry').textContent, '');
    assert.doesNotMatch(app.get('chat-help').textContent, /timer|inactivity/);
    app.get('message-input').value = 'Hello'; await app.fire('message-form', 'submit'); assert.equal(app.state.sends[0].groupId, 'study');
    app.state.groupUpdated({ ...group, deletedAt: { toMillis: () => Date.now() }, deletedBy: 'alice' });
    assert.equal(app.get('send-message').disabled, true); assert.equal(app.rows().length, 0); assert.match(app.get('message-list').textContent, /group was deleted/);
    assert.equal(app.get('group-settings').hidden, true);
});

test('theme follows the system until chosen, persists, and profile shows the signed-in account', async () => {
    const app = createApp({ dark: true, displayName: 'TheGambler101' }); assert.equal(app.document.documentElement.dataset.chatTheme, 'dark');
    app.media['(prefers-color-scheme: dark)'].onChange({ matches: false }); assert.equal(app.document.documentElement.dataset.chatTheme, 'light');
    await app.fire('theme-toggle'); assert.equal(app.preferences.get('fiu-chat:theme'), 'dark');
    assert.match(app.get('theme-toggle').getAttribute('aria-label'), /Switch to light/);
    app.media['(prefers-color-scheme: dark)'].onChange({ matches: false }); assert.equal(app.document.documentElement.dataset.chatTheme, 'dark');
    const restored = createApp({ stored: Object.fromEntries(app.preferences), dark: false }); assert.equal(restored.document.documentElement.dataset.chatTheme, 'dark');
    await app.open(); await app.fire('profile-button'); assert.equal(app.get('profile-panel').open, true);
    assert.equal(app.get('profile-display-name').textContent, 'TheGambler101'); assert.equal(app.get('profile-initials').textContent, 'TG');
    assert.equal(app.get('profile-user-id').textContent, 'alice'); await app.fire('close-profile'); assert.equal(app.get('profile-panel').open, false);
});

test('mobile list/conversation navigation is remembered; forum tabs switch the active pane', async () => {
    const app = createApp({ mobile: true, stored: { 'fiu-chat:mobile-view': 'list' } }); await app.open();
    assert.equal(app.get('chat-panel').dataset.mobileView, 'list'); app.state.selectGroup(null);
    assert.equal(app.get('chat-panel').dataset.mobileView, 'conversation'); await app.fire('back-to-chats');
    assert.equal(app.get('chat-panel').dataset.mobileView, 'list'); assert.equal(app.preferences.get('fiu-chat:mobile-view'), 'list');
    await app.fire('forums-tab'); assert.equal(app.state.forumsActive, true); assert.equal(app.get('chats-sidebar').hidden, true);
    assert.equal(app.get('forums-panel').hidden, false); assert.equal(app.get('chat-panel').dataset.section, 'forums');
    await app.fire('chats-tab'); assert.equal(app.state.forumsActive, false); assert.equal(app.get('forums-panel').hidden, true);
});

test('menu dismisses outside or on Escape; animated chat close cleans up subscriptions', async () => {
    const app = createApp(); await app.open(); app.state.receive([message()], false); app.state.role(true); await app.fire('chat-more');
    assert.equal(app.get('chat-options').hidden, false); assert.equal(app.get('chat-more').getAttribute('aria-expanded'), 'true');
    const escape = await app.documentEvents.fire('keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true); assert.equal(app.get('chat-options').hidden, true); assert.equal(app.get('chat-panel').open, true);
    assert.equal(app.document.activeElement, app.get('chat-more'));
    await app.fire('chat-more'); await app.documentEvents.fire('click', { target: app.get('message-input') }); assert.equal(app.get('chat-options').hidden, true);
    const staleReceive = app.state.receive, staleRole = app.state.role;
    const closeEvent = await app.fire('chat-panel', 'cancel'); assert.equal(closeEvent.defaultPrevented, true);
    assert.equal(app.get('chat-panel').classList.contains('is-closing'), true); assert.equal(app.get('chat-panel').open, true);
    app.flushTimers(); assert.equal(app.get('chat-panel').open, false);
    assert.equal(app.state.messageStops, 1); assert.equal(app.state.roleStops, 1); assert.equal(app.state.forumDisposals, 1);
    staleReceive([message('late')], false); staleRole(true); assert.equal(app.row('late'), undefined); assert.equal(app.get('clear-chat').hidden, true);
});

test('reduced motion skips entrance and closes immediately; listener errors disable sending', async () => {
    const app = createApp({ reduced: true }); await app.open(); app.state.receive([message()], false); app.state.receive([message(), message('new')], false);
    assert.equal(app.row('new').classList.contains('message-enter'), false); app.state.listenError({ code: 'permission-denied' });
    assert.equal(app.get('send-message').disabled, true); assert.equal(app.get('connection-status').dataset.state, 'error');
    assert.match(app.get('connection-status').textContent, /access/); await app.fire('close-chat');
    assert.equal(app.get('chat-panel').open, false); assert.equal(app.get('chat-panel').classList.contains('is-closing'), false);
});

test('incoming messages preserve reading position and provide a jump to latest', async () => {
    const app = createApp(); await app.open(); const history = Array.from({ length: 15 }, (_, index) => message(`history-${index}`));
    app.state.receive(history, false); app.get('message-list').scrollTop = 100; const oldPosition = app.get('message-list').scrollTop;
    app.state.receive([...history, message('new')], false); assert.equal(app.get('message-list').scrollTop, oldPosition);
    assert.equal(app.get('new-message-indicator').hidden, false); assert.match(app.get('new-message-indicator').textContent, /1 new message/);
    await app.fire('new-message-indicator'); assert.equal(app.get('message-list').scrollTop, app.get('message-list').scrollHeight);
    assert.equal(app.get('new-message-indicator').hidden, true);
});

const at = (id, sender, milliseconds) => ({ ...message(id, sender, sender), createdAt: { toDate: () => new Date(milliseconds) } });
const separators = app => app.get('message-list').children.filter(child => child.classList.contains('message-date'));
const pointer = (extra = {}) => ({ pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: 200, clientY: 200, ...extra });

test('message runs honor exact two-minute, one-hour and local-day boundaries', async () => {
    const app = createApp(); await app.open();
    const start = new Date(2026, 8, 26, 10, 0).getTime();
    const afterTwo = start + 120000;
    const afterRun = afterTwo + 120001;
    const beforeHour = afterRun + 3599999;
    const afterHour = beforeHour + 3600000;
    const nextDay = new Date(2026, 8, 27, 0, 0).getTime();
    const history = [at('a', 'bob', start), at('b', 'bob', afterTwo), at('c', 'bob', afterRun),
        at('d', 'bob', beforeHour), at('e', 'bob', afterHour), at('f', 'bob', nextDay),
        at('g', 'bob', nextDay + 120000), at('h', 'alice', nextDay + 121000),
        at('i', 'alice', nextDay + 122000), at('j', 'bob', nextDay + 123000)];
    app.state.receive(history, false);
    assert.deepEqual(separators(app).map(row => row.dataset.beforeMessage), ['a', 'e', 'f']);
    assert.equal(app.row('a').classList.contains('message-group-start'), true);
    assert.equal(app.row('a').classList.contains('message-group-end'), false);
    assert.equal(app.row('b').classList.contains('message-continuation'), true, 'exactly two minutes stays grouped');
    assert.equal(app.row('b').querySelector('.message-meta').hidden, true);
    assert.equal(app.row('b').classList.contains('message-gap'), false);
    assert.equal(app.row('c').classList.contains('message-continuation'), false, 'two minutes plus 1 ms starts a new run');
    assert.equal(app.row('c').classList.contains('message-gap'), true);
    assert.equal(app.row('c').querySelector('.message-meta').hidden, false);
    assert.equal(app.row('f').classList.contains('message-continuation'), false, 'a new day always starts a run');
    assert.equal(app.row('g').classList.contains('message-continuation'), true);
    assert.equal(app.row('h').classList.contains('message-group-start'), true, 'a sender change starts a run');
    assert.equal(app.row('h').querySelector('.message-meta').hidden, true, 'own name does not repeat');
    assert.equal(app.row('i').classList.contains('message-continuation'), true);
    assert.equal(app.row('j').querySelector('.message-meta').hidden, false);
    assert.equal(app.rows().filter(row => !row.querySelector('.message-delivery').hidden).length, 1);
    assert.equal(app.row('i').querySelector('.message-delivery').hidden, false);
    assert.match(separators(app)[0].textContent, / · 10:00/);
    assert.match(separators(app)[1].textContent, /12:04/);
    assert.doesNotMatch(separators(app)[1].textContent, /Sep/);
    assert.match(separators(app)[2].textContent, / · /);
    const row = app.row('b'), firstSeparator = separators(app)[0];
    app.state.receive(history, false);
    assert.equal(app.row('b'), row); assert.equal(separators(app)[0], firstSeparator);
});

test('midnight adds a separator even for messages only a second apart', async () => {
    const app = createApp(); await app.open();
    app.state.receive([at('late', 'bob', new Date(2026, 8, 26, 23, 59, 59).getTime()),
        at('early', 'bob', new Date(2026, 8, 27, 0, 0, 0).getTime())], false);
    assert.equal(separators(app).length, 2);
    assert.equal(app.row('early').classList.contains('message-continuation'), false);
});

test('live timestamp reorder and regroup retain keyed rows and the first visible reading position', async () => {
    const app = createApp(); await app.open();
    const start = new Date(2026, 8, 26, 10).getTime();
    const first = at('first', 'bob', start), pending = { ...at('pending', 'bob', start + 60000), pending: true };
    const later = Array.from({ length: 14 }, (_, index) => at(`later-${index}`, 'bob', start + (index + 2) * 60000));
    app.state.receive([first, pending, ...later], false);
    const firstRow = app.row('first'), pendingRow = app.row('pending');
    // A server timestamp may move a known row ahead of earlier snapshot rows.
    const acknowledged = at('pending', 'bob', start - 3600000);
    app.state.receive([acknowledged, first, ...later], false);
    assert.equal(app.rows()[0], pendingRow); assert.equal(app.row('first'), firstRow);
    const firstSeparator = separators(app)[0];
    const list = app.get('message-list'); list.scrollTop = 100;
    const visibleOffset = pendingRow.getBoundingClientRect().top;
    const corrected = at('first', 'bob', start - 3540000);
    app.state.receive([acknowledged, corrected, ...later], false);
    assert.equal(pendingRow.getBoundingClientRect().top, visibleOffset, 'regrouping below the visible row must not move it');
    assert.equal(list.scrollTop, 100); assert.equal(app.row('first'), firstRow);
    assert.equal(separators(app)[0], firstSeparator);
    assert.equal(firstRow.classList.contains('message-continuation'), true);
    assert.equal(firstRow.querySelector('.message-meta').hidden, true);
    assert.deepEqual(separators(app).map(row => row.dataset.beforeMessage), ['pending', 'later-0']);
    assert.equal(app.rows().some(row => row.classList.contains('message-enter')), false);
    assert.equal(app.get('message-announcer').textContent, '', 'metadata changes must not announce old messages');
    assert.equal(app.get('new-message-indicator').hidden, true);
});

test('timestamp rail reflow anchors the first visible DOM row after a snapshot reorder', async () => {
    const app = createApp(); await app.open();
    const start = new Date(2026, 8, 26, 10).getTime();
    const first = at('first', 'bob', start), second = at('second', 'bob', start + 60000);
    const later = Array.from({ length: 14 }, (_, index) => at(`later-${index}`, 'bob', start + (index + 2) * 60000));
    app.state.receive([first, second, ...later], false);
    app.state.receive([at('second', 'bob', start - 60000), first, ...later], false);
    const list = app.get('message-list'), visibleRow = app.row('second');
    // Reserving the timestamp rail can wrap this visible bubble onto another line.
    visibleRow.measureHeight = () => list.classList.contains('times-visible') ? 120 : 80;
    list.scrollTop = 100; const offset = visibleRow.getBoundingClientRect().top;
    await app.fire('toggle-message-times');
    assert.equal(visibleRow.getBoundingClientRect().top, offset);
    assert.equal(list.scrollTop, 100);
    await app.fire('toggle-message-times');
    assert.equal(visibleRow.getBoundingClientRect().top, offset);
    list.scrollTop = list.scrollHeight - list.clientHeight;
    await app.fire('toggle-message-times');
    assert.equal(list.scrollTop, list.scrollHeight, 'readers at the bottom stay with the latest message');
});

test('times are hidden by default; menu and keyboard controls expose accessible exact dates', async () => {
    const app = createApp(); await app.open();
    const instant = new Date(2026, 8, 26, 10, 42, 37);
    app.state.receive([at('a', 'bob', instant.getTime())], false);
    const time = app.row('a').querySelector('.message-time');
    assert.equal(time.getAttribute('aria-hidden'), 'true');
    assert.equal(time.parentNode, app.row('a'), 'timestamps live in the rail instead of the name header');
    assert.equal(time.getAttribute('aria-label'), instant.toLocaleString());
    assert.equal(time.dateTime, instant.toISOString()); assert.equal(time.title, instant.toLocaleString());
    const label = app.get('toggle-message-times').querySelector('[data-message-times-label]');
    await app.fire('toggle-message-times');
    assert.equal(app.get('message-list').classList.contains('times-visible'), true);
    assert.equal(app.get('toggle-message-times').getAttribute('aria-pressed'), 'true');
    assert.equal(label.textContent, 'Hide message times'); assert.equal(time.getAttribute('aria-hidden'), 'false');
    await app.fire('message-list', 'keydown', { key: 'T' });
    assert.equal(app.get('message-list').classList.contains('times-visible'), false);
    await app.fire('message-list', 'keydown', { key: 't' });
    const escape = await app.fire('message-list', 'keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true); assert.equal(app.get('chat-panel').open, true);
    assert.equal(app.get('message-list').classList.contains('times-visible'), false);
    assert.equal(app.get('toggle-message-times').querySelector('[data-message-times-label]'), label, 'label changes preserve the menu structure');
});

test('a leftward touch gesture peeks at times and release resnaps without pinning', async () => {
    const app = createApp(); await app.open(); app.state.receive([message()], false);
    const list = app.get('message-list');
    await app.fire('message-list', 'pointerdown', pointer());
    await app.fire('message-list', 'pointermove', pointer({ clientX: 194 }));
    assert.equal(list.classList.contains('times-peeking'), false, 'a tap-sized motion must not start a drag');
    const move = await app.fire('message-list', 'pointermove', pointer({ clientX: 168, clientY: 202 }));
    assert.equal(move.defaultPrevented, true); assert.equal(list.hasPointerCapture(7), true);
    assert.equal(list.style.getPropertyValue('--time-reveal'), '32px');
    assert.equal(list.classList.contains('is-time-dragging'), true);
    await app.fire('message-list', 'pointermove', pointer({ clientX: 0 }));
    assert.equal(list.style.getPropertyValue('--time-reveal'), '64px', 'overdrag is clamped');
    await app.fire('message-list', 'pointerup', pointer({ clientX: 0 }));
    assert.equal(list.style.getPropertyValue('--time-reveal'), '0px');
    assert.equal(list.classList.contains('times-peeking'), false); assert.equal(list.hasPointerCapture(7), false);
    assert.equal(app.get('toggle-message-times').getAttribute('aria-pressed'), 'false');
});

test('vertical scrolling, rightward movement and interactive controls do not become time drags', async () => {
    const app = createApp(); await app.open(); app.state.receive([message()], false); app.state.role(true);
    const list = app.get('message-list');
    await app.fire('message-list', 'pointerdown', pointer());
    const vertical = await app.fire('message-list', 'pointermove', pointer({ clientX: 197, clientY: 229 }));
    assert.equal(vertical.defaultPrevented, false); assert.equal(list.hasPointerCapture(7), false);
    await app.fire('message-list', 'pointermove', pointer({ clientX: 130, clientY: 230 }));
    assert.equal(list.classList.contains('times-peeking'), false, 'vertical intent remains with native scroll');
    await app.fire('message-list', 'pointerdown', pointer());
    await app.fire('message-list', 'pointermove', pointer({ clientX: 225 }));
    assert.equal(list.classList.contains('times-peeking'), false);
    const remove = app.row('message-1').querySelector('.remove-message');
    await app.fire('message-list', 'pointerdown', pointer({ target: remove }));
    await app.fire('message-list', 'pointermove', pointer({ clientX: 100 }));
    assert.equal(list.classList.contains('times-peeking'), false);
});

test('mouse drag, pointer cancellation and conversation reset clear the time gesture safely', async () => {
    const app = createApp({ reduced: true }); await app.open(); app.state.receive([message()], false);
    const list = app.get('message-list');
    await app.fire('message-list', 'pointerdown', pointer({ pointerType: 'mouse' }));
    await app.fire('message-list', 'pointermove', pointer({ pointerType: 'mouse', clientX: 150 }));
    assert.equal(list.classList.contains('times-peeking'), true);
    await app.fire('message-list', 'pointercancel', pointer({ pointerType: 'mouse' }));
    assert.equal(list.classList.contains('times-peeking'), false); assert.equal(list.style.getPropertyValue('--time-reveal'), '0px');
    await app.fire('message-list', 'pointerdown', pointer({ pointerType: 'mouse' }));
    await app.fire('message-list', 'pointermove', pointer({ pointerType: 'mouse', clientX: 150, buttons: 0 }));
    assert.equal(list.classList.contains('times-peeking'), false, 'lost mouse release must not leave a latent gesture');
    await app.fire('toggle-message-times'); app.state.selectGroup(null);
    assert.equal(list.classList.contains('times-visible'), false); assert.equal(app.get('toggle-message-times').getAttribute('aria-pressed'), 'false');
    app.state.receive([message()], false);
    await app.fire('message-list', 'pointerdown', pointer());
    await app.fire('message-list', 'pointermove', pointer({ clientX: 150 }));
    app.state.selectGroup(null);
    assert.equal(list.hasPointerCapture(7), false); assert.equal(list.classList.contains('times-peeking'), false);
});

test('only pending and latest outgoing delivery states display; sent feedback is not repeated in the composer', async () => {
    const app = createApp(); await app.open();
    const start = new Date(2026, 8, 26, 10).getTime();
    const first = at('one', 'alice', start), next = at('two', 'alice', start + 1000);
    app.state.receive([first, { ...next, pending: true }], false);
    assert.equal(app.row('one').querySelector('.message-delivery').hidden, true);
    assert.equal(app.row('two').querySelector('.message-delivery').textContent, 'Sending…');
    app.state.receive([first, next], false);
    assert.equal(app.row('two').querySelector('.message-delivery').textContent, 'Sent');
    assert.equal(app.row('one').querySelector('.message-delivery').hidden, true);
    app.get('message-input').value = 'Hello'; await app.fire('message-form', 'submit');
    assert.equal(app.get('message-status').dataset.kind, 'delivery');
});
