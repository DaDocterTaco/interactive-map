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
    let stopPosts, stopPost, stopReplies, listVersion = 0, threadVersion = 0;
    const drafts = new Map();
    const alerts = mountAlerts({ user });
    const expiry = watchReportExpiry(() => active ? posts : [], renderPosts);
    const date = value => value?.toDate?.().toLocaleString() || "Just now";
    const failure = error => error.code === "permission-denied"
        ? "This discussion is unavailable or your session has expired. Close and reopen chat to retry."
        : "Could not connect. Check your connection and try again.";
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
        syncComposer();
    }
    function syncComposer() {
        const alert = $("forum-category-input").value === "Alert";
        alerts.setComposer(active && !$("forum-compose").hidden && alert);
        $("forum-compose-title").textContent = alert ? "Report a campus concern" : "Start a discussion";
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
        $("forum-post-list").replaceChildren();
        for (const post of filtered) {
            const button = node("button", "", "forum-post-card");
            button.type = "button";
            button.setAttribute("aria-current", String(selected === post.id));
            button.append(node("span", post.category, "forum-category"), node("strong", post.title),
                node("small", `${post.name} · ${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}`),
                node("small", `${date(post.createdAt)}${post.pending ? " · Saving…" : ""}`));
            if (post.category === "Alert") {
                button.className += " forum-alert-card";
                button.append(node("small", post.location.label), node("small", `${post.confirmationCount} user confirmations`));
                const state = reportState(post);
                button.append(node("small", state === "resolved" ? "Resolved" : state === "expired" ? "Expired" : post.verification?.status === "approved" ? (post.pending ? "Saving approval…" : "Verified by authorized reviewer") : "Awaiting verifier review", "alert-verification"));
            }
            button.addEventListener("click", () => openPost(post.id));
            $("forum-post-list").append(button);
        }
        $("forum-empty").hidden = filtered.length > 0;
        $("forum-empty").textContent = search || category ? "No matching discussions in the loaded posts. Try another search or load more." : "No discussions yet. Start the first one.";
        $("forum-load-more").hidden = posts.length < postLimit;
    }
    function listenPosts() {
        stopPosts?.();
        const version = ++listVersion;
        $("forum-list-status").textContent = "Loading discussions…";
        $("forum-list-status").dataset.state = "loading";
        stopPosts = service.watchPosts(postLimit, (data, cached) => {
            if (!active || disposed || version !== listVersion) return;
            posts = data;
            expiry.refresh();
            renderPosts();
            $("forum-list-status").textContent = cached ? "Connecting… Showing any saved discussions." : "";
            $("forum-list-status").dataset.state = cached ? "loading" : "ready";
        }, error => {
            if (active && !disposed && version === listVersion) {
                $("forum-list-status").textContent = failure(error);
                $("forum-list-status").dataset.state = "error";
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
                item.append(node("strong", `${reply.name}${reply.authorId === currentPost?.authorId ? " · Original poster" : ""}`),
                    node("p", `${date(reply.createdAt)}${reply.pending ? " · Sending…" : ""}`, "forum-meta"),
                    node("p", reply.body, "forum-body"));
                $("forum-reply-list").append(item);
            }
            $("forum-replies-status").textContent = cached ? "Connecting… Replies may be cached." : replies.length ? "" : "No replies yet. Be the first to respond.";
            $("forum-older-replies").hidden = replies.length < replyLimit || (currentPost && currentPost.replyCount <= replies.length);
        }, error => {
            if (active && !disposed && version === threadVersion) $("forum-replies-status").textContent = failure(error);
        });
    }
    function openPost(id, focus = true) {
        // Switching threads invalidates callbacks from the old post/replies
        // and restores that thread's unsent reply draft.
        saveDraft(); stopThread();
        selected = id; currentPost = null; replyLimit = 50;
        const version = threadVersion;
        show("forum-thread"); renderPosts();
        $("forum-thread-title").textContent = "Loading discussion…";
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
            alerts.render(post);
            $("forum-reply-submit").disabled = !post || post.pending || replying;
            if (!post) {
                $("forum-thread-title").textContent = "Discussion unavailable";
                $("forum-thread-body").textContent = "";
                $("forum-thread-status").textContent = "This discussion is no longer available. Choose another one.";
                stopReplies?.();
                $("forum-reply-list").replaceChildren();
                return;
            }
            $("forum-thread-title").textContent = post.title;
            $("forum-thread-category").textContent = post.category;
            $("forum-thread-meta").textContent = `${post.name} · ${date(post.createdAt)}${post.pending ? " · Saving…" : ""}`;
            $("forum-thread-body").textContent = post.body;
            $("forum-reply-heading").textContent = `${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}`;
        }, error => {
            if (!active || disposed || version !== threadVersion) return;
            currentPost = null;
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
    on("forum-new-post", "click", () => {
        saveDraft(); stopThread(); selected = null; show("forum-compose"); renderPosts(); $("forum-title-input").focus();
    });
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
        $("forum-compose-status").textContent = "Saving your discussion…";
        $("forum-compose-status").dataset.state = "loading";
        const version = threadVersion;
        try {
            const id = await service.createPost(user, $("forum-title-input").value, $("forum-body-input").value, $("forum-category-input").value, alerts.location());
            if (disposed) return;
            $("forum-post-form").reset();
            alerts.reset(); syncComposer();
            $("forum-compose-status").textContent = "Discussion posted.";
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
