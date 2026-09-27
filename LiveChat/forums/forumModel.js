export const topics = ["Classes", "Study spaces", "Campus life", "Parking & transit", "Housing", "Other"];
export const timestamp = value => value?.toMillis?.() ?? value?.toDate?.().getTime() ?? 0;

// Filtering and sorting always run over the complete campus post snapshot.
// Pagination is presentation-only, so older matches are never silently omitted.
export function selectPosts(posts, { view = "discussions", search = "", category = "", topic = "", unanswered = false, sort = "newest", saved = [] } = {}) {
    const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return posts.filter(post => {
        if (view === "discussions" && post.category === "Alert") return false;
        if (view === "alerts" && post.category !== "Alert") return false;
        if (view === "saved" && !saved.includes(post.id)) return false;
        if (category && post.category !== category || topic && post.topic !== topic) return false;
        if (unanswered && (post.category !== "Question" || post.acceptedReplyId || post.replyCount > 0)) return false;
        const haystack = [post.title, post.body, post.name, post.topic, post.location?.label].join(" ").toLocaleLowerCase();
        return words.every(word => haystack.includes(word));
    }).sort((a, b) => {
        if (sort === "helpful" && Boolean(a.acceptedReplyId) !== Boolean(b.acceptedReplyId)) return Number(Boolean(b.acceptedReplyId)) - Number(Boolean(a.acceptedReplyId));
        const field = sort === "active" ? "lastActivityAt" : "createdAt";
        return timestamp(b[field] ?? b.createdAt) - timestamp(a[field] ?? a.createdAt) || a.id.localeCompare(b.id);
    });
}

export function buildReplyTree(replies) {
    const nodes = new Map(replies.map(reply => [reply.id, { reply, children: [] }]));
    const roots = [];
    for (const node of nodes.values()) {
        let parent = nodes.get(node.reply.parentId), cursor = parent;
        const seen = new Set([node.reply.id]);
        while (cursor) {
            if (seen.has(cursor.reply.id)) { parent = null; break; }
            seen.add(cursor.reply.id); cursor = nodes.get(cursor.reply.parentId);
        }
        if (parent) parent.children.push(node); else roots.push(node);
    }
    return roots;
}

export function postIdFromURL(href) {
    try {
        const id = new URL(href).searchParams.get("forum");
        return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
    } catch { return null; }
}

export function postURL(href, id) {
    const url = new URL(href);
    if (id) url.searchParams.set("forum", id); else url.searchParams.delete("forum");
    return url.href;
}
