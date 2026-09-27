const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../forums/forumModel.js'), 'utf8').replaceAll('export ', '');
const { selectPosts, buildReplyTree, postURL, postIdFromURL, timestamp } = new Function(source + ';return {selectPosts,buildReplyTree,postURL,postIdFromURL,timestamp}')();
const stamp = n => ({ toMillis: () => n });
const posts = Array.from({ length: 75 }, (_, i) => ({ id: `post-${i}`, title: i === 74 ? 'Astronomy club telescope night' : `Question ${i}`, body: i === 74 ? 'Orion observation for students' : 'Share recommendations', name: i === 74 ? 'Maya Chen' : 'Jordan Lee', category: 'Question', topic: i % 3 ? 'Classes' : 'Campus life', replyCount: 0, createdAt: stamp(100 - i), lastActivityAt: stamp(i) }));

test('archive search includes posts beyond initial pages and combines tokens across fields', () => {
    assert.deepEqual(selectPosts(posts, { search: '  MAYA Orion telescope  ' }).map(post => post.id), ['post-74']);
    assert.equal(selectPosts(posts, { search: 'telescope missing' }).length, 0);
    assert.equal(selectPosts(posts, { search: '  ' }).length, 75);
});
test('search recognizes topic and alert location', () => {
    assert.ok(selectPosts(posts, { search: 'campus life' }).every(post => post.topic === 'Campus life'));
    const alert = { ...posts[0], id: 'wet', category: 'Alert', location: { label: 'Library east entrance' } };
    assert.equal(selectPosts([alert], { view: 'alerts', search: 'library entrance' })[0].id, 'wet');
});
test('latest, activity, and helpful sorting are deterministic and do not mutate source order', () => {
    assert.equal(selectPosts(posts, { sort: 'newest' })[0].id, 'post-0');
    assert.equal(selectPosts(posts, { sort: 'active' })[0].id, 'post-74');
    const answered = posts.map(post => ({ ...post, ...(post.id === 'post-74' ? { acceptedReplyId: 'answer' } : {}) }));
    assert.equal(selectPosts(answered, { sort: 'helpful' })[0].id, 'post-74');
    assert.equal(selectPosts(answered, { sort: 'helpful' })[1].id, 'post-0');
    assert.equal(answered[0].id, 'post-0');
    assert.deepEqual(selectPosts([{ ...posts[0], id: 'b' }, { ...posts[0], id: 'a' }]).map(post => post.id), ['a', 'b']);
});
test('saved, topic, type, and unanswered filters combine without leaking irrelevant posts', () => {
    assert.deepEqual(selectPosts(posts, { view: 'saved', saved: ['post-74', 'post-73'], topic: 'Classes', search: 'Orion' }).map(post => post.id), ['post-74']);
    assert.equal(selectPosts(posts, { view: 'saved', saved: [] }).length, 0);
    const mixed = [{ ...posts[0], replyCount: 1 }, { ...posts[1], acceptedReplyId: 'r' }, posts[2], { ...posts[3], category: 'Comment' }];
    assert.deepEqual(selectPosts(mixed, { unanswered: true }).map(post => post.id), ['post-2']);
    assert.deepEqual(selectPosts(mixed, { category: 'Comment' }).map(post => post.id), ['post-3']);
});
test('alerts remain separable from discussion feed', () => {
    const alert = { ...posts[0], id: 'alert', category: 'Alert' };
    assert.equal(selectPosts([...posts, alert], { view: 'discussions' }).length, 75);
    assert.deepEqual(selectPosts([...posts, alert], { view: 'alerts' }).map(post => post.id), ['alert']);
});
test('activity timestamp at epoch zero is not replaced by creation time', () => {
    const oldActive = { ...posts[0], id: 'epoch', lastActivityAt: stamp(0), createdAt: stamp(999) };
    const recent = { ...posts[0], id: 'recent', lastActivityAt: stamp(1), createdAt: stamp(1) };
    assert.equal(selectPosts([oldActive, recent], { sort: 'active' })[0].id, 'recent');
    assert.equal(timestamp({ toDate: () => new Date(12) }), 12);
    assert.equal(timestamp(null), 0);
});
test('nested replies retain relationships even when children arrive before parents', () => {
    const input = [{ id: 'grandchild', parentId: 'child' }, { id: 'child', parentId: 'root' }, { id: 'root' }];
    const tree = buildReplyTree(input);
    assert.equal(tree.length, 1); assert.equal(tree[0].reply.id, 'root');
    assert.equal(tree[0].children[0].reply.id, 'child');
    assert.equal(tree[0].children[0].children[0].reply.id, 'grandchild');
    assert.equal(input[0].id, 'grandchild');
});
test('orphaned, self-referencing and cyclic replies remain visible without recursion loops', () => {
    const tree = buildReplyTree([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'self', parentId: 'self' }, { id: 'orphan', parentId: 'missing' }, { id: 'child', parentId: 'orphan' }]);
    assert.equal(tree.length, 4);
    const ids = [];
    const visit = node => { ids.push(node.reply.id); node.children.forEach(visit); };
    tree.forEach(visit);
    assert.deepEqual(ids.sort(), ['a', 'b', 'child', 'orphan', 'self']);
});
test('deep links preserve unrelated map state and reject malformed post IDs', () => {
    const link = postURL('https://campus.test/index.html?campusView=3d#north', 'post-74');
    assert.equal(postIdFromURL(link), 'post-74');
    assert.equal(new URL(link).searchParams.get('campusView'), '3d');
    assert.equal(new URL(link).hash, '#north');
    const cleared = postURL(link, null);
    assert.equal(new URL(cleared).searchParams.has('forum'), false);
    assert.equal(new URL(cleared).hash, '#north');
    for (const value of ['../bad', '<script>', 'a'.repeat(129), '']) assert.equal(postIdFromURL(`https://campus.test/?forum=${encodeURIComponent(value)}`), null);
    assert.equal(postIdFromURL('not a URL'), null);
});
