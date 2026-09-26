const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const elements = {};
function element() {
    return {
        value: '', textContent: '', hidden: false, disabled: false, dataset: {}, children: [], listeners: {},
        addEventListener(event, handler, options) {
            this.listeners[event] = handler;
            options?.signal?.addEventListener('abort', () => delete this.listeners[event]);
        },
        setAttribute(key, value) { this[key] = value; },
        append(...children) { this.children.push(...children); },
        replaceChildren() { this.children = []; }, focus() {}, reset() {}
    };
}
for (const [, id] of fs.readFileSync(path.join(root, 'mainChat.html'), 'utf8').matchAll(/id="([^"]+)"/g)) elements[id] = element();
let postsCallback, postCallback, replyCallback, stopped = 0, sendResolve, sentTo, saves = 0;
let failPost = false, failReply = false;
let composerVisible = false, alertDisabled = false, savedArgs;
const selectedLocation = { label: 'Library', latitude: 25.75396, longitude: -80.37662 };
const service = {
    watchPosts(count, callback) { postsCallback = callback; return () => stopped++; },
    watchPost(id, callback) { postCallback = callback; return () => stopped++; },
    watchReplies(id, count, callback) { replyCallback = callback; return () => stopped++; },
    async createPost(...args) { saves++; savedArgs = args; assert.equal(alertDisabled, true); if (failPost) throw Error('Offline'); return 'created'; },
    async sendReply(user, id) { sentTo = id; if (failReply) throw Error('Offline'); await new Promise(resolve => { sendResolve = resolve; }); }
};
const code = fs.readFileSync(path.join(root, 'forums/forumUI.js'), 'utf8').replace(/^import.*;\s*/gm, '').replace('export function', 'function');
const mount = vm.runInNewContext(code + '\nmountForums;', { service, mountAlerts: () => ({ render() {}, setComposer(value) { composerVisible = value; }, setDisabled(value) { alertDisabled = value; }, location() { return selectedLocation; }, reset() {}, dispose() {} }), AbortController, document: { getElementById: id => { assert.ok(elements[id], id); return elements[id]; }, createElement: element } });
const fire = (id, event = 'click') => elements[id].listeners[event]({ preventDefault() {} });
const post = (id, title) => ({ id, title, body: '<script>hello</script>', category: 'Question', name: 'Alice', authorId: 'alice', replyCount: 1, createdAt: { toDate: () => new Date() } });
(async () => {
    const controller = mount({ user: { uid: 'alice', displayName: 'Alice' } });
    controller.setActive(true);
    postsCallback([post('a', 'First post'), post('b', 'Second post')], false);
    const cards = elements['forum-post-list'].children;
    cards[0].listeners.click();
    postCallback(post('a', 'First post'));
    replyCallback([{ name: 'Bob', authorId: 'bob', body: '<img src=x onerror=alert(1)>', createdAt: null }], false);
    assert.equal(elements['forum-thread-body'].textContent, '<script>hello</script>');
    assert.equal(elements['forum-reply-list'].children[0].children[2].textContent, '<img src=x onerror=alert(1)>');
    elements['forum-reply-input'].value = 'Draft A';
    failReply = true;
    await fire('forum-reply-form', 'submit');
    assert.equal(elements['forum-reply-input'].value, 'Draft A');
    assert.match(elements['forum-reply-status'].textContent, /not saved/);
    failReply = false;
    const pending = fire('forum-reply-form', 'submit');
    assert.equal(sentTo, 'a');
    cards[1].listeners.click();
    postCallback(post('b', 'Second post'));
    elements['forum-reply-input'].value = 'Draft B';
    sendResolve(); await pending;
    assert.equal(elements['forum-reply-input'].value, 'Draft B');
    cards[0].listeners.click();
    assert.equal(elements['forum-reply-input'].value, '');
    cards[1].listeners.click();
    assert.equal(elements['forum-reply-input'].value, 'Draft B');
    elements['forum-search'].value = 'second'; fire('forum-search', 'input');
    assert.equal(elements['forum-post-list'].children.length, 1);
    fire('forum-new-post');
    elements['forum-title-input'].value = 'Keep title'; elements['forum-body-input'].value = 'Keep body';
    failPost = true;
    await fire('forum-post-form', 'submit');
    assert.equal(elements['forum-title-input'].value, 'Keep title');
    assert.equal(elements['forum-body-input'].value, 'Keep body');
    assert.equal(elements['forum-post-submit'].disabled, false);
    assert.equal(elements['forum-body-input'].disabled, false);
    fire('forum-new-alert');
    assert.equal(elements['forum-category-input'].value, 'Alert');
    assert.equal(composerVisible, true);
    assert.equal(elements['forum-post-submit'].textContent, 'Publish alert');
    await fire('forum-post-form', 'submit');
    assert.equal(savedArgs[3], 'Alert'); assert.equal(savedArgs[4], selectedLocation);
    assert.equal(alertDisabled, false);
    elements['forum-category-input'].value = 'Question'; fire('forum-category-input', 'change');
    assert.equal(composerVisible, false);
    elements['forum-search'].value = 'library';
    postsCallback([{ ...post('alert', 'Concern'), category: 'Alert', location: selectedLocation, confirmationCount: 2 }], false);
    assert.equal(elements['forum-post-list'].children.length, 1);
    const stalePosts = postsCallback, stalePost = postCallback, previousTitle = elements['forum-thread-title'].textContent;
    controller.setActive(false);
    stalePosts([post('late', 'Late callback')], false); stalePost(post('late', 'Late callback'));
    assert.equal(elements['forum-thread-title'].textContent, previousTitle);
    assert.ok(stopped >= 3);
    controller.dispose();
    assert.equal(elements['forum-post-form'].listeners.submit, undefined);
    assert.equal(saves, 2);
    console.log('PASS: forum safe rendering, search, failed-write draft retention, thread switching during sends, per-thread drafts, stale snapshot guards and listener cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
