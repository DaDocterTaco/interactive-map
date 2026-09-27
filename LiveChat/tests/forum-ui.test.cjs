// Exercise the real controller with controllable services. No Firebase/live writes.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), elements = {}, dynamic = [], document = { activeElement: null };
function element(tag = 'div') {
    const classes = new Set();
    const el = { tagName: tag, id: '', value: '', _text: '', hidden: false, disabled: false, dataset: {}, children: [], listeners: {}, attributes: {}, scrollTop: 0, scrollHeight: 24, style: { setProperty() {} },
        setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k]; },
        addEventListener(k, fn, options) { this.listeners[k] = fn; options?.signal?.addEventListener('abort', () => { if (this.listeners[k] === fn) delete this.listeners[k]; }); },
        append(...items) { for (const item of items) this.insertBefore(item, null); },
        insertBefore(item, next) { item.remove(); let i = this.children.indexOf(next); if (i < 0) i = this.children.length; this.children.splice(i, 0, item); item.parent = this; },
        replaceChildren(...items) { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; this.append(...items); },
        remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } },
        focus() { document.activeElement = this; }, select() {}, scrollIntoView() {}, getBoundingClientRect() { return { top: 0, bottom: 100 }; },
        querySelectorAll(selector) { return this.children.flatMap(c => [c, ...c.querySelectorAll('*')]).filter(c => selector === '*' || selector === '[data-reply-control]' && c.dataset.replyControl); },
        reset() { if (this.id === 'forum-post-form') { for (const id of ['forum-title-input', 'forum-body-input', 'forum-topic-input', 'alert-location-label', 'alert-latitude', 'alert-longitude']) elements[id].value = ''; elements['forum-category-input'].value = 'Question'; } },
        classList: { add(name) { classes.add(name); }, toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
        get firstElementChild() { return this.children[0]; }, get lastElementChild() { return this.children.at(-1); },
        get isConnected() { return !!elements[this.id] || !!this.parent?.isConnected; },
        get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }, set textContent(v) { this.replaceChildren(); this._text = String(v); }
    }; dynamic.push(el); return el;
}
for (const [, id] of fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8').matchAll(/id="([^"]+)"/g)) { const el = element(); el.id = id; elements[id] = el; }
elements['forum-save'].append(element('span'), element('span'));
elements['forum-reply-sort'].value = 'helpful';
document.getElementById = id => elements[id] || dynamic.find(el => el.id === id && el.isConnected) || null;
document.createElement = element; document.createTextNode = text => { const el = element('#text'); el.textContent = text; return el; };
document.querySelectorAll = selector => dynamic.filter(el => el.isConnected && selector === '[data-forum-topic]' && Object.hasOwn(el.dataset, 'forumTopic'));
const data = new Map(), sessionStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
const windowListeners = new Map(), window = { innerHeight: 844, addEventListener(type, callback, options) { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type).add(callback); options?.signal?.addEventListener('abort', () => windowListeners.get(type).delete(callback)); }, dispatchEvent(event) { for (const callback of [...windowListeners.get(event.type) || []]) callback(event); } };
let postsCallback, postsError, savedCallback, savedError, postCallback, postError, repliesCallback, repliesError, stopped = 0, alertDisabled = false;
const sent = [], publications = [], bookmarks = []; let failSave = false, failReply = false, failPost = false, delayPost = false;
const service = {
    watchAllPosts(cb, err) { postsCallback = cb; postsError = err; return () => stopped++; },
    watchSavedPosts(uid, cb, err) { savedCallback = cb; savedError = err; return () => stopped++; },
    watchPost(id, cb, err) { postCallback = cb; postError = err; return () => stopped++; },
    watchAllReplies(id, cb, err) { repliesCallback = cb; repliesError = err; return () => stopped++; },
    async setSavedPost(...args) { bookmarks.push(args); if (failSave) throw Error('Offline'); },
    async createPost(...args) { assert.equal(alertDisabled, true); if (failPost) throw Error('Offline'); if (!delayPost) return 'created'; return new Promise(resolve => publications.push({ args, resolve })); },
    async sendReply(...args) { if (failReply) throw Error('Offline'); return new Promise(resolve => sent.push({ args, resolve })); },
    async setAcceptedAnswer() {}
};
const model = new Function(fs.readFileSync(path.join(root, 'forums/forumModel.js'), 'utf8').replaceAll('export ', '') + ';return{topics,timestamp,selectPosts,buildReplyTree,postIdFromURL,postURL}')();
const location = { href: 'https://campus.test/index.html?campusView=3d' };
const context = { ...model, ...require('./lifecycle-helper.cjs')(), service, document, sessionStorage, location, URL, Date, AbortController, window,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout: () => 0, clearTimeout() {}, matchMedia: () => ({ matches: true }),
    history: { state: null, pushState(state, unused, url) { this.state = state; location.href = url; }, replaceState(state, unused, url) { this.state = state; location.href = url; } },
    navigator: { clipboard: { writeText: async () => {} } },
    mountAlerts: () => ({ render() {}, setComposer() {}, setDisabled(value) { alertDisabled = value; }, location() { return null; }, reset() {}, dispose() {} }) };
const source = fs.readFileSync(path.join(root, 'forums/forumUI.js'), 'utf8').replace(/^import.*;\s*/gm, '').replace('export function', 'function');
const mount = vm.runInNewContext(source + ';mountForums', context);
const user = { uid: 'alice', displayName: 'Alice' }, fire = (id, type = 'click') => { assert.ok(elements[id].listeners[type], `${id}:${type}`); return elements[id].listeners[type]({ preventDefault() {} }); };
const post = (id, title) => ({ id, title, body: '<script>literal text</script>', category: 'Question', name: 'Alice', authorId: 'alice', replyCount: 0, createdAt: { toMillis: () => 1000 } });
const all = Array.from({ length: 60 }, (_, i) => post(`p${i}`, i === 59 ? 'telescope archive' : `Question ${i}`));
const open = id => { const card = elements['forum-post-list'].children.find(el => el.id === `forum-card-${id}`); assert.ok(card, `card:${id}`); return card.children[1].firstElementChild.listeners.click(); };
const showPost = id => { postCallback(all.find(post => post.id === id)); repliesCallback([], false); };
const replyDraft = text => { elements['forum-reply-input'].value = text; fire('forum-reply-input', 'input'); };
const rows = () => elements['forum-reply-list'].children;
const replies = [{ id: 'r1', authorId: 'bob', name: 'Bob', body: '<img src=x onerror=bad()>', createdAt: null }, { id: 'r2', parentId: 'r1', authorId: 'alice', name: 'Alice', body: 'Child', createdAt: null }];
(async () => {
    let controller = mount({ user }); controller.setActive(true); savedCallback([], false);
    assert.equal(elements['forum-list-placeholder'].hidden, false); postsCallback([], true); assert.equal(elements['forum-empty'].hidden, true);
    postsCallback([], false); assert.equal(elements['forum-empty'].hidden, false); postsError(Error('offline')); assert.equal(elements['forum-empty'].hidden, true);
    assert.equal(elements['forum-error-retry'].hidden, false); postsCallback(all, false); assert.equal(elements['forum-error-retry'].hidden, true);
    assert.equal(elements['forum-post-list'].children.length, 20); elements['forum-search'].value = 'telescope'; fire('forum-search', 'input'); assert.equal(elements['forum-post-list'].children.length, 1);
    fire('forum-empty-clear'); const first = elements['forum-post-list'].children[0]; postsCallback(all, false); assert.equal(elements['forum-post-list'].children[0], first);
    const save = first.children[5].children[1]; save.focus(); failSave = true; await save.listeners.click(); assert.equal(save.getAttribute('aria-pressed'), 'false'); assert.equal(document.activeElement, save);
    failSave = false; await save.listeners.click(); assert.equal(save.getAttribute('aria-pressed'), 'true'); savedCallback(['p0'], false);
    fire('forum-sidebar-saved'); assert.equal(elements['forum-post-list'].children.length, 1); fire('forum-sidebar-saved');
    const staleSaved = savedCallback; controller.setActive(false); controller.setActive(true); postsCallback(all, false); savedCallback(['p1'], false); staleSaved(['p0'], false);
    fire('forum-sidebar-saved'); assert.equal(elements['forum-post-list'].children[0].id, 'forum-card-p1'); fire('forum-sidebar-saved');
    elements['forum-content'].scrollTop = 183;
    open('p0'); showPost('p0'); assert.equal(elements['forum-thread-body'].textContent, '<script>literal text</script>'); assert.match(location.href, /forum=p0/);
    replyDraft('Draft before browser Back'); controller.setActive(false);
    location.href = model.postURL(location.href, null); window.dispatchEvent({ type: 'popstate' });
    assert.equal(elements['forum-thread'].hidden, false, 'Inactive Forums ignores browser navigation until reopened');
    controller.setActive(true);
    assert.equal(elements['forum-thread'].hidden, true, 'Reactivation reconciles a removed forum URL with the feed');
    assert.equal(elements['forum-welcome'].hidden, false); assert.equal(elements['forum-content'].scrollTop, 183, 'Return restores the saved feed position');
    assert.equal(document.activeElement, elements['forum-post-list'].children[0].children[1].firstElementChild, 'Return restores focus to the discussion opener');
    open('p0'); showPost('p0'); assert.equal(elements['forum-reply-input'].value, 'Draft before browser Back', 'Inactive browser navigation preserves the discussion draft'); replyDraft('');
    repliesCallback(replies, false); assert.equal(rows().length, 2); assert.match(rows()[0].textContent, /<img src=x onerror=bad\(\)>/);
    let controls = elements['forum-reply-list'].querySelectorAll('[data-reply-control]'); controls.find(el => el.dataset.replyControl === 'collapse-r1').listeners.click(); assert.equal(rows().length, 1);
    controls = elements['forum-reply-list'].querySelectorAll('[data-reply-control]'); controls.find(el => el.dataset.replyControl === 'collapse-r1').listeners.click(); assert.equal(rows().length, 2);
    controls = elements['forum-reply-list'].querySelectorAll('[data-reply-control]'); controls.find(el => el.dataset.replyControl === 'respond-r1').listeners.click();
    replyDraft('Draft A'); failReply = true; await fire('forum-reply-form', 'submit'); assert.equal(elements['forum-reply-input'].value, 'Draft A'); assert.match(elements['forum-reply-status'].textContent, /not saved/); failReply = false;
    const pendingA = fire('forum-reply-form', 'submit'); assert.equal(sent[0].args[3], 'r1'); assert.equal(elements['forum-reply-input'].disabled, true);
    fire('forum-back'); open('p1'); showPost('p1'); assert.equal(elements['forum-reply-input'].disabled, false, 'A different thread stays usable while the first send is pending');
    replyDraft('Draft B'); sent[0].resolve('new-a'); await pendingA; assert.equal(elements['forum-reply-input'].value, 'Draft B');
    fire('forum-back'); open('p0'); showPost('p0'); assert.equal(elements['forum-reply-input'].value, '');
    replyDraft('Close while sending'); const pendingRemount = fire('forum-reply-form', 'submit'); controller.dispose();
    controller = mount({ user }); controller.setActive(true); postsCallback(all, false); showPost('p0');
    assert.equal(elements['forum-reply-input'].disabled, true, 'Remount retains in-flight duplicate guard');
    await fire('forum-reply-form', 'submit'); assert.equal(sent.length, 2, 'A remounted controller cannot resubmit in-flight draft');
    sent[1].resolve('new-remount'); await pendingRemount; assert.equal(elements['forum-reply-input'].value, ''); assert.equal(elements['forum-reply-input'].disabled, false);
    assert.equal(JSON.parse(sessionStorage.getItem('fiu-forums:v2:alice:replies')).p0, undefined);
    repliesCallback(replies, false); replyDraft('Keep unavailable draft'); const staleReplies = repliesCallback; postCallback(null);
    assert.equal(rows().length, 0); assert.equal(elements['forum-thread-author'].textContent, ''); assert.equal(elements['forum-copy-link'].disabled, true); assert.equal(elements['forum-save'].disabled, true); assert.equal(elements['forum-reply-input'].value, 'Keep unavailable draft');
    staleReplies(replies, false); assert.equal(rows().length, 0, 'Late reply snapshot cannot repopulate unavailable thread');
    fire('forum-back'); open('p1'); showPost('p1'); postError(Error('Offline')); assert.equal(elements['forum-thread-body'].textContent, ''); assert.equal(rows().length, 0);
    fire('forum-back'); fire('forum-new-post'); elements['forum-title-input'].value = 'Retain title'; elements['forum-body-input'].value = 'Retain body'; elements['forum-topic-input'].value = 'Classes'; failPost = true;
    await fire('forum-post-form', 'submit'); assert.equal(elements['forum-title-input'].value, 'Retain title'); assert.equal(elements['forum-post-submit'].disabled, false); failPost = false;
    delayPost = true; const pendingPost = fire('forum-post-form', 'submit'); controller.dispose(); controller = mount({ user }); controller.setActive(true); postsCallback(all, false);
    assert.equal(elements['forum-post-submit'].disabled, true, 'In-flight publish persists across remount'); await fire('forum-post-form', 'submit'); assert.equal(publications.length, 1);
    publications[0].resolve('new-post'); await pendingPost; assert.equal(elements['forum-title-input'].value, ''); assert.equal(elements['forum-post-submit'].disabled, false); assert.equal(elements['forum-welcome'].hidden, false, 'Old write completion does not navigate a remounted controller');
    fire('forum-new-alert'); assert.equal(elements['forum-category-input'].value, 'Alert'); assert.equal(elements['forum-topic-field'].hidden, true); fire('forum-new-post'); assert.equal(elements['forum-category-input'].value, 'Question');
    const stalePosts = postsCallback; controller.setActive(false); stalePosts([], false); assert.notEqual(elements['forum-post-list'].children.length, 0); controller.dispose();
    assert.ok(stopped > 10); assert.equal(elements['forum-post-form'].listeners.submit, undefined); assert.equal(windowListeners.get('fiu-forum-write-finished').size, 0);
    console.log('PASS: controller archive search, saved rollback/stale snapshots, keyed rows/focus, safe text, nested replies, failed drafts, concurrent thread sends, reply/post remount races, unavailable clearing, alerts and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
