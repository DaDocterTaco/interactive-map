import * as service from "./forumService.js";
import { mountAlerts } from "./alertUI.js";
import { reportState, watchReportExpiry } from "./reportLifecycle.js";

// Coordinates the forum list, composer, selected thread, and alert controls.
// Each live listener is stopped when its view is no longer active.
export function mountForums({ user }) {
    const $ = id => document.getElementById(id);
    const events = new AbortController();
    const on = (id, event, callback) => $(id).addEventListener(event, callback, { signal: events.signal });
    let disposed = false, active = false, posts = [], selected = null, currentPost = null;
    let postLimit = 50, replyLimit = 50, posting = false, replying = false;
    let stopPosts, stopPost, stopReplies, listVersion = 0, threadVersion = 0, loadingPosts = false, listFailed = false;
    const drafts = new Map();
    const alerts = mountAlerts({ user });
    const expiry = watchReportExpiry(() => active ? posts : [], renderPosts);
    const date = value => {
        const time = value?.toDate?.();
        if (!time) return "Just now";
        const today = time.toDateString() === new Date().toDateString();
        return today ? time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
            : time.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const failure = error => error.code === "permission-denied"
        ? "Access unavailable. Reopen chat to retry."
        : "Could not connect. Try again.";
    function node(tag, content, className) {
        const element = document.createElement(tag);
        element.textContent = content;
        if (className) element.className = className;
        return element;
    }
    function stopThread() {
        threadVersion++;
        stopPost?.(); stopReplies?.(); stopPost = stopReplies = null;
        alerts.render(null);
    }
    function show(view) {
        for (const id of ["forum-welcome", "forum-compose", "forum-thread"]) $(id).hidden = id !== view;
        $("forums-panel").dataset.detail = view === "forum-welcome" ? "false" : "true";
        if (active) $("chat-panel").dataset.mobileView = view === "forum-welcome" ? "list" : "conversation";
        $("forum-content").scrollTop = 0;
        syncComposer();
    }
    function syncComposer() {
        const alert = $("forum-category-input").value === "Alert";
        alerts.setComposer(active && !$("forum-compose").hidden && alert);
        $("forum-compose-title").textContent = alert ? "Report an alert" : "New post";
        $("forum-compose-description").textContent = alert ? "Share a concern and where it happened." : "Visible to everyone on campus.";
        $("forum-post-submit").textContent = alert ? "Publish alert" : "Publish post";
    }
    function saveDraft() {
        if (selected) drafts.set(selected, $("forum-reply-input").value);
    }
    function renderPosts() {
        // Search and category filters apply to the currently loaded page set;
        // Load more expands the listener before those filters run again.
        const search = $("forum-search").value.trim().toLowerCase();
        const category = $("forum-filter").value;
        const filtered = posts.filter(post => (!category || post.category === category)
            && `${post.title} ${post.body} ${post.name} ${post.location?.label || ""}`.toLowerCase().includes(search));
        const focusedPost = document.activeElement?.dataset?.forumPost;
        let restoreFocus;
        $("forum-post-list").replaceChildren();
        for (const post of filtered) {
            const button = node("button", "", "forum-post-card");
            button.type = "button";
            button.dataset.forumPost = post.id;
            button.setAttribute("aria-current", String(selected === post.id));
            const top = node("span", "", "forum-card-top");
            let category = post.category, state = "";
            if (post.category === "Alert") {
                button.className += " forum-alert-card";
                state = reportState(post);
                category = state === "resolved" ? "Resolved alert" : state === "expired" ? "Expired alert"
                    : post.verification?.status === "approved" ? "Verified alert" : "Unverified alert";
                if (state === "active") state = post.verification?.status === "approved" ? "approved" : "pending";
            }
            const chip = node("span", category, "forum-category");
            chip.dataset.state = state;
            top.append(chip, node("span", post.pending ? "Saving…" : date(post.createdAt), "forum-card-time"));
            button.append(top, node("strong", post.title),
                node("span", post.category === "Alert" ? post.location?.label || "" : post.body, "forum-card-preview"),
                node("small", `${post.name} · ${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}`, "forum-card-meta"));
            button.addEventListener("click", () => openPost(post.id));
            $("forum-post-list").append(button);
            if (focusedPost === post.id) restoreFocus = button;
        }
        restoreFocus?.focus({ preventScroll: true });
        $("forum-empty").hidden = filtered.length > 0 || loadingPosts || listFailed;
        $("forum-empty").textContent = search || category ? "No matches in the loaded posts." : "No posts yet. Start the first one.";
        $("forum-list-placeholder").hidden = !loadingPosts || posts.length > 0;
        $("forum-post-list").hidden = loadingPosts && posts.length === 0;
        $("forum-load-more").hidden = posts.length < postLimit;
    }
    function listenPosts() {
        stopPosts?.();
        const version = ++listVersion;
        loadingPosts = !posts.length; listFailed = false;
        $("forum-list-status").textContent = "Loading posts…";
        $("forum-list-status").dataset.state = "loading";
        $("forum-retry").setAttribute("aria-busy", "true");
        renderPosts();
        stopPosts = service.watchPosts(postLimit, (data, cached) => {
            if (!active || disposed || version !== listVersion) return;
            posts = data;
            loadingPosts = cached && !data.length;
            expiry.refresh();
            renderPosts();
            $("forum-list-status").textContent = cached ? data.length ? "Connecting · Showing saved posts" : "Connecting…" : "";
            $("forum-list-status").dataset.state = cached ? "loading" : "ready";
            $("forum-retry").setAttribute("aria-busy", String(cached));
        }, error => {
            if (active && !disposed && version === listVersion) {
                $("forum-list-status").textContent = failure(error);
                $("forum-list-status").dataset.state = "error";
                loadingPosts = false; listFailed = true; renderPosts();
                $("forum-retry").setAttribute("aria-busy", "false");
            }
        });
    }
    function listenReplies() {
        stopReplies?.();
        const version = threadVersion;
        const id = selected;
        $("forum-replies-status").textContent = "Loading replies…";
        stopReplies = service.watchReplies(id, replyLimit, (replies, cached) => {
            if (!active || disposed || version !== threadVersion || id !== selected) return;
            $("forum-reply-list").replaceChildren();
            for (const reply of replies) {
                const item = node("li", "");
                const avatar = node("span", reply.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase(), "forum-reply-avatar");
                avatar.setAttribute("aria-hidden", "true");
                const content = node("div", "", "forum-reply-content");
                const meta = node("div", "", "forum-reply-meta");
                meta.append(node("strong", reply.name), node("span", reply.pending ? "Sending…" : date(reply.createdAt), "forum-meta"));
                if (reply.authorId === currentPost?.authorId) meta.append(node("span", "Author", "forum-author-badge"));
                content.append(meta, node("p", reply.body, "forum-body"));
                item.append(avatar, content);
                $("forum-reply-list").append(item);
            }
            $("forum-replies-status").textContent = cached ? replies.length ? "Connecting · Showing saved replies" : "Connecting…" : replies.length ? "" : "No replies yet.";
            $("forum-replies-status").dataset.state = cached ? "loading" : "ready";
            $("forum-older-replies").hidden = replies.length < replyLimit || (currentPost && currentPost.replyCount <= replies.length);
        }, error => {
            if (active && !disposed && version === threadVersion) {
                $("forum-replies-status").textContent = failure(error);
                $("forum-replies-status").dataset.state = "error";
            }
        });
    }
    function openPost(id, focus = true) {
        // Switching threads invalidates callbacks from the old post/replies
        // and restores that thread's unsent reply draft.
        saveDraft(); stopThread();
        selected = id; currentPost = null; replyLimit = 50;
        const version = threadVersion;
        show("forum-thread"); renderPosts();
        $("forum-thread-title").textContent = "Loading post…";
        $("forum-thread-loading").hidden = false;
        $("forum-thread-body").textContent = "";
        $("forum-thread-meta").textContent = "";
        $("forum-thread-category").textContent = "";
        $("forum-reply-heading").textContent = "Replies";
        $("forum-reply-list").replaceChildren();
        $("forum-thread-status").textContent = "";
        $("forum-thread-status").dataset.state = "ready";
        $("forum-reply-status").textContent = "";
        $("forum-reply-input").value = drafts.get(id) || "";
        $("forum-reply-submit").disabled = true;
        if (focus) $("forum-thread-title").focus();
        stopPost = service.watchPost(id, post => {
            if (!active || disposed || version !== threadVersion) return;
            currentPost = post;
            $("forum-thread-loading").hidden = true;
            alerts.render(post);
            $("forum-reply-submit").disabled = !post || post.pending || replying;
            if (!post) {
                $("forum-thread-title").textContent = "Post unavailable";
                $("forum-thread-body").textContent = "";
                $("forum-thread-status").textContent = "Choose another post from the list.";
                stopReplies?.();
                $("forum-reply-list").replaceChildren();
                return;
            }
            $("forum-thread-title").textContent = post.title;
            $("forum-thread-category").textContent = post.category;
            $("forum-thread-meta").textContent = `${post.name} · ${date(post.createdAt)}${post.pending ? " · Saving…" : ""}`;
            $("forum-thread-body").textContent = post.body;
            $("forum-reply-heading").textContent = post.replyCount ? `Replies (${post.replyCount})` : "Replies";
        }, error => {
            if (!active || disposed || version !== threadVersion) return;
            currentPost = null;
            $("forum-thread-loading").hidden = true;
            $("forum-thread-title").textContent = "Post unavailable";
            alerts.render(null);
            $("forum-reply-submit").disabled = true;
            $("forum-thread-status").textContent = failure(error);
            $("forum-thread-status").dataset.state = "error";
        });
        listenReplies();
    }
    on("forum-search", "input", renderPosts);
    on("forum-filter", "change", renderPosts);
    on("forum-category-input", "change", syncComposer);
    on("forum-load-more", "click", () => { postLimit += 50; listenPosts(); });
    on("forum-older-replies", "click", () => { replyLimit += 50; listenReplies(); });
    on("forum-retry", "click", () => { listenPosts(); if (selected) openPost(selected, false); });
    const composePost = () => {
        if (posting) return;
        if ($("forum-category-input").value === "Alert") $("forum-category-input").value = "Question";
        saveDraft(); stopThread(); selected = null; show("forum-compose"); renderPosts(); $("forum-title-input").focus();
    };
    on("forum-new-post", "click", composePost);
    on("forum-welcome-compose", "click", composePost);
    on("forum-new-alert", "click", () => {
        if (posting) return;
        saveDraft(); stopThread(); selected = null; $("forum-category-input").value = "Alert";
        show("forum-compose"); renderPosts(); $("forum-title-input").focus();
    });
    const back = () => { saveDraft(); stopThread(); selected = null; show("forum-welcome"); renderPosts(); $("forum-new-post").focus(); };
    on("forum-back", "click", back);
    on("forum-cancel-post", "click", back);
    on("forum-post-form", "submit", async event => {
        event.preventDefault();
        if (posting || disposed || !active) return;
        posting = true;
        alerts.setDisabled(true);
        $("forum-post-submit").disabled = true;
        $("forum-post-submit").setAttribute("aria-busy", "true");
        for (const id of ["forum-title-input", "forum-body-input", "forum-category-input"]) $(id).disabled = true;
        $("forum-compose-status").textContent = "Publishing…";
        $("forum-compose-status").dataset.state = "loading";
        const version = threadVersion;
        try {
            const id = await service.createPost(user, $("forum-title-input").value, $("forum-body-input").value, $("forum-category-input").value, alerts.location());
            if (disposed) return;
            $("forum-post-form").reset();
            alerts.reset(); syncComposer();
            $("forum-compose-status").textContent = "Published.";
            $("forum-compose-status").dataset.state = "success";
            if (active && version === threadVersion) openPost(id);
        } catch (error) {
            if (!disposed) {
                $("forum-compose-status").textContent = `Post not saved. ${error.message || failure(error)}`;
                $("forum-compose-status").dataset.state = "error";
            }
        } finally {
            posting = false;
            if (!disposed) {
                $("forum-post-submit").disabled = false;
                $("forum-post-submit").setAttribute("aria-busy", "false");
                alerts.setDisabled(false);
                for (const id of ["forum-title-input", "forum-body-input", "forum-category-input"]) $(id).disabled = false;
            }
        }
    });
    on("forum-reply-form", "submit", async event => {
        event.preventDefault();
        if (replying || disposed || !active || !currentPost || currentPost.pending) return;
        const id = selected, body = $("forum-reply-input").value, version = threadVersion;
        replying = true;
        $("forum-reply-submit").disabled = true;
        $("forum-reply-submit").setAttribute("aria-busy", "true");
        $("forum-reply-input").disabled = true;
        $("forum-reply-status").textContent = "Sending reply…";
        $("forum-reply-status").dataset.state = "loading";
        try {
            await service.sendReply(user, id, body);
            if (disposed) return;
            if (drafts.get(id) === body) drafts.delete(id);
            if (selected === id && $("forum-reply-input").value === body) $("forum-reply-input").value = "";
            if (active && version === threadVersion) {
                $("forum-reply-status").textContent = "Reply posted.";
                $("forum-reply-status").dataset.state = "success";
            }
        } catch (error) {
            if (!disposed && selected === id) {
                $("forum-reply-status").textContent = `Reply not saved. ${error.message || failure(error)}`;
                $("forum-reply-status").dataset.state = "error";
            }
        } finally {
            replying = false;
            if (!disposed) {
                $("forum-reply-submit").disabled = !currentPost || currentPost.pending;
                $("forum-reply-submit").setAttribute("aria-busy", "false");
                $("forum-reply-input").disabled = false;
            }
        }
    });
    $("forum-post-form").reset();
    $("forum-reply-input").value = "";
    $("forum-reply-input").disabled = false;
    $("forum-post-submit").disabled = false;
    $("forum-post-submit").setAttribute("aria-busy", "false");
    $("forum-reply-submit").setAttribute("aria-busy", "false");
    for (const id of ["forum-title-input", "forum-body-input", "forum-category-input"]) $(id).disabled = false;
    $("forum-compose-status").textContent = "";
    show("forum-welcome");
    return {
        setActive(value) {
            if (active === value || disposed) return;
            active = value;
            expiry.refresh();
            if (value) {
                listenPosts();
                if (selected) openPost(selected, false); else syncComposer();
                $("chat-panel").dataset.mobileView = "list";
            }
            else { saveDraft(); listVersion++; stopPosts?.(); stopThread(); alerts.setComposer(false); }
        },
        dispose() {
            disposed = true; active = false; listVersion++; stopPosts?.(); stopThread(); alerts.dispose(); expiry.dispose(); events.abort(); drafts.clear();
        }
    };
}
