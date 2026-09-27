import '../../CampusUI/mobileInput.js';
import * as service from "./forumService.js?v=alerts-20260927-1";
import { mountAlerts } from "./alertUI.js?v=polish-20260927-1";
import { reportState, alertStatus, alertLabels, watchReportExpiry } from "./reportLifecycle.js?v=alerts-20260927-1";
import { topics, timestamp, selectPosts, buildReplyTree, postIdFromURL, postURL } from "./forumModel.js?v=forum-approved-4";

// Module lifetime outlasts closing/reopening the dialog. Keep in-flight writes
// shared so remounting cannot submit the same draft twice.
const replyOperations = new Map(), postOperations = new Map();
const writeEvent = "fiu-forum-write-finished";

export function mountForums({ user }) {
    const $ = id => document.getElementById(id), events = new AbortController();
    const on = (id, type, fn) => $(id).addEventListener(type, fn, { signal: events.signal });
    const filterPopup = $("forum-filter-options"), filterToggle = $("forum-filter-toggle");
    function closeFilters() { if (filterPopup.matches?.(":popover-open")) filterPopup.hidePopover(); }
    window.addEventListener("keydown", event => {
        if (event.key !== "Escape" || !filterPopup.matches?.(":popover-open")) return;
        event.preventDefault(); event.stopPropagation(); closeFilters(); filterToggle.focus({ preventScroll: true });
    }, { signal: events.signal, capture: true });
    on("forum-filter-options", "toggle", event => {
        if (event.newState === "open") $("forum-filter-close").focus({ preventScroll: true });
    });
    on("forum-filter-options", "beforetoggle", event => {
        filterToggle.setAttribute("aria-expanded", String(event.newState === "open"));
        if (event.newState !== "open") return;
        const rect = filterToggle.getBoundingClientRect(), viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
        const popupWidth = Math.min(360, width - 24), below = top + height - rect.bottom - 20;
        filterPopup.style.width = `${popupWidth}px`;
        filterPopup.style.left = `${Math.max(left + 12, Math.min(rect.right - popupWidth, left + width - popupWidth - 12))}px`;
        filterPopup.style.bottom = "auto";
        filterPopup.style.top = `${rect.bottom + 8}px`;
        filterPopup.style.maxHeight = `${Math.max(0, below)}px`;
    });
    window.addEventListener("campus-tab-change", closeFilters, { signal: events.signal });
    window.addEventListener("resize", closeFilters, { signal: events.signal });
    on("forum-content", "scroll", closeFilters);
    // The dialog DOM survives closing, while each controller owns fresh cards.
    $("forum-post-list").replaceChildren();
    for (const item of document.querySelectorAll("[data-alert-filter]")) item.setAttribute("aria-pressed", String(item.dataset.alertFilter === "active"));
    const key = `fiu-forums:v2:${user.uid}`;
    const read = (suffix, fallback) => { try { return JSON.parse(sessionStorage.getItem(key + suffix)) ?? fallback; } catch { return fallback; } };
    const write = (suffix, value) => { try { sessionStorage.setItem(key + suffix, JSON.stringify(value)); } catch { /* The in-memory draft is retained. */ } };
    const draftData = read(":replies", {});
    const drafts = new Map(Object.entries(draftData && typeof draftData === "object" && !Array.isArray(draftData) ? draftData : {}));
    const saved = new Set(), pendingSaves = new Map(), collapsed = new Set(), cards = new Map();
    const alerts = mountAlerts({ user });
    let disposed = false, active = false, posts = [], replies = [], selected = null, currentPost = null;
    let alertFilter = "active", alertDiscussion = false;
    let view = "discussions", topic = "", search = "", sort = "newest", screen = "forum-welcome";
    let shown = 20, replyShown = 20, listScroll = 0, lastOpened = null, toastTimer;
    let loading = true, listFailed = false, cachedList = false, posting = postOperations.has(user.uid), answerPending = false;
    let listVersion = 0, savedVersion = 0, threadVersion = 0, replyVersion = 0, threadUnavailable = false, stopPosts, stopPost, stopReplies, stopSaved, replyTarget = null;
    const instance = {}, replyOperationKey = id => `${user.uid}:${id}`, replying = () => replyOperations.has(replyOperationKey(selected));
    const expiry = watchReportExpiry(() => active ? posts : [], renderPosts);
    function node(tag, text = "", className = "") { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
    function icon(name) { const el = node("span", "", `icon icon-${name}`); el.setAttribute("aria-hidden", "true"); return el; }
    function button(text, fn, className = "forum-text-button", symbol) { const el = node("button", "", className); el.type = "button"; if (symbol) el.append(icon(symbol)); el.append(node("span", text)); el.addEventListener("click", fn); return el; }
    function avatar(name) { const el = node("span", "", "forum-avatar"); setAvatar(el, name); el.setAttribute("aria-hidden", "true"); return el; }
    function setAvatar(el, name = "Campus") {
        const parts = name.trim().split(/\s+/); el.textContent = parts.length > 1 ? (parts[0][0] + parts.at(-1)[0]).toUpperCase() : name.slice(0, 2).toUpperCase();
        const hash = [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 0);
        const tone = [1, 3, 0, 2][(hash >>> 0) % 4];
        el.dataset.tone = String(tone);
    }
    function feedback(id, text, state = "ready") { $(id).textContent = text; $(id).dataset.state = state; }
    function toast(text, state = "success") { clearTimeout(toastTimer); feedback("forum-toast", text, state); $("forum-toast").hidden = false; toastTimer = setTimeout(() => { $("forum-toast").hidden = true; }, state === "error" ? 6500 : 3200); }
    function date(value) {
        const time = timestamp(value); if (!time) return "Just now";
        const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
        return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : minutes < 10080 ? `${Math.floor(minutes / 1440)}d ago` : new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    const failure = error => error?.code === "permission-denied" ? "Access unavailable. Close and reopen the community to retry." : "Could not connect. Try again.";
    function setURL(id, push = false) { const url = postURL(location.href, id); if (url !== location.href) history[push ? "pushState" : "replaceState"]({ ...history.state, forum: id }, "", url); }
    function rememberReply() {
        if (!selected) return;
        const body = $("forum-reply-input").value;
        if (body || replyTarget) drafts.set(selected, { body, target: replyTarget }); else drafts.delete(selected);
        write(":replies", Object.fromEntries([...drafts].slice(-30)));
    }
    const composeFields = ["forum-title-input", "forum-body-input", "forum-category-input", "forum-topic-input", "alert-location-label", "alert-latitude", "alert-longitude", "alert-issue-type"];
    function rememberCompose() { write(":compose", Object.fromEntries(composeFields.map(id => [id, $(id).value]))); }
    function sameReply(draft, body, target) { return draft?.body === body && draft?.target?.id === target?.id; }
    function clearSentDraft(id, body, target) {
        if (sameReply(drafts.get(id), body, target)) drafts.delete(id);
        // A newer controller may have saved another draft while this write ran.
        const stored = read(":replies", {});
        if (stored && typeof stored === "object" && !Array.isArray(stored) && sameReply(stored[id], body, target)) { delete stored[id]; write(":replies", stored); }
    }
    function composeValues() { return Object.fromEntries(composeFields.map(id => [id, $(id).value])); }
    const sameCompose = (a, b) => composeFields.every(id => a?.[id] === b?.[id]);
    function syncPostControls() {
        posting = postOperations.has(user.uid);
        for (const id of ["forum-title-input", "forum-body-input", "forum-category-input", "forum-topic-input", "forum-post-submit"]) $(id).disabled = posting;
        alerts.setDisabled(posting); $("forum-post-submit").setAttribute("aria-busy", String(posting)); syncComposer();
    }
    function stopThread() { threadVersion++; replyVersion++; stopPost?.(); stopReplies?.(); stopPost = stopReplies = null; alerts.render(null); }
    function show(next, reset = true) {
        if (next !== "forum-welcome") closeFilters();
        screen = next;
        for (const id of ["forum-welcome", "forum-compose", "forum-thread"]) $(id).hidden = id !== next;
        const state = next === "forum-welcome" ? "feed" : next === "forum-thread" ? "thread" : "compose";
        $("forums-panel").dataset.detail = String(next !== "forum-welcome"); $("forums-panel").dataset.view = state; $("chat-panel").dataset.forumView = state;
        $("forum-reply-dock").hidden = next !== "forum-thread"; $("forum-mobile-actions").hidden = next !== "forum-welcome";
        if (active) $("chat-panel").dataset.mobileView = next === "forum-welcome" ? "list" : "conversation";
        if (reset) $("forum-content").scrollTop = 0;
        syncComposer();
    }
    function syncComposer() {
        const isAlert = $("forum-category-input").value === "Alert";
        alerts.setComposer(active && screen === "forum-compose" && isAlert);
        $("forum-compose-title").textContent = isAlert ? "Report a problem" : "New post";
        $("forum-compose-description").textContent = isAlert ? "Tell us what happened and where. A reviewer will check it before it appears on the map." : "Ask a question or share something useful with campus.";
        $("forum-compose").dataset.alert = String(isAlert);
        $("forum-type-field").hidden = isAlert; $("alert-type-field").hidden = !isAlert;
        $("forum-title-label").textContent = isAlert ? "Short summary" : "Title";
        $("forum-body-label").textContent = isAlert ? "What should people know?" : "Details";
        $("forum-title-input").placeholder = isAlert ? "For example, flooding at the east entrance" : "What would you like to share?";
        $("forum-body-input").placeholder = isAlert ? "Describe what you saw and when. Include how it affects people." : "Add a little context…";
        $("forum-post-submit").textContent = posting ? "Sending…" : isAlert ? "Submit report" : "Publish post"; $("forum-topic-field").hidden = isAlert;
        $("forum-cancel-post").lastChild.textContent = isAlert ? "Back to alerts" : "Back to discussions";
    }
    function options() { return { view, search, topic, sort, saved: [...saved] }; }
    function anchor(container) {
        const scroll = $("forum-content"), top = scroll.getBoundingClientRect().top;
        const item = [...container.children].find(child => child.getBoundingClientRect().bottom > top + 8);
        return { id: item?.id, offset: item?.getBoundingClientRect().top, scrollTop: scroll.scrollTop };
    }
    function restoreAnchor(value) {
        if (value.scrollTop < 8) return;
        const el = value.id && $(value.id); $("forum-content").scrollTop = el ? value.scrollTop + el.getBoundingClientRect().top - value.offset : value.scrollTop;
    }
    function syncNavigation() {
        const reports = view === "alerts";
        if (reports && sort === "helpful") sort = "newest";
        for (const id of ["forum-search", "forum-mobile-search"]) {
            if ($(id).value !== search) $(id).value = search;
            $(id).placeholder = reports ? "Search reports…" : "Search discussions…";
            $(`${id}-label`).textContent = reports ? "Search reports" : "Search discussions";
        }
        for (const id of ["forum-sort", "forum-mobile-sort"]) {
            if ($(id).dataset.reports !== String(reports)) {
                const choices = reports ? [["newest", "Newest reports"], ["active", "Recently active"]] : [["newest", "Latest"], ["active", "Recently active"], ["helpful", "Helpful answers"]];
                $(id).replaceChildren(...choices.map(([value, label]) => { const option = node("option", label); option.value = value; return option; }));
                $(id).dataset.reports = String(reports);
            }
            $(id).value = sort; $(id).dataset.sort = sort;
            $(`${id}-label`).textContent = reports ? "Sort reports" : "Sort discussions";
        }
        $("forum-retry").setAttribute("aria-label", reports ? "Refresh reports" : "Refresh discussions");
        $("forum-post-list").setAttribute("aria-label", reports ? "Reports" : "Forum posts");
        for (const el of document.querySelectorAll("[data-forum-topic]")) {
            const chosen = view !== "saved" && (el.dataset.forumTopic === "alerts" ? view === "alerts" : view === "discussions" && el.dataset.forumTopic === topic);
            el.classList.toggle("is-active", chosen); el.setAttribute("aria-pressed", String(chosen));
        }
        for (const id of ["forum-sidebar-saved", "forum-mobile-saved"]) { $(id).setAttribute("aria-pressed", String(view === "saved")); $(id).classList.toggle("is-active", view === "saved"); }
        $("forum-feed-title").textContent = view === "saved" ? "Saved discussions" : view === "alerts" ? "Campus alerts" : topic || "Campus forums";
        const filterScope = view === "saved" ? "Saved" : reports ? "Alerts" : topic || "All topics";
        const sortLabel = sort === "active" ? "Recently active" : sort === "helpful" ? "Helpful answers" : "Latest";
        $("forum-filter-summary").textContent = `${filterScope} · ${sortLabel}`;
    }
    function renderPosts() {
        if (disposed) return;
        syncNavigation();
        const list = $("forum-post-list"), position = anchor(list), focused = document.activeElement, state = options(), filtered = selectPosts(posts, state).filter(post => view !== "alerts" || (alertFilter === "mine" ? post.authorId === user.uid : alertFilter === "history" ? ["resolved", "rejected", "expired"].includes(alertStatus(post)) : alertFilter === "review" ? ["pending", "needs_details"].includes(alertStatus(post)) : alertStatus(post) === "approved"));
        $("alert-feed-filters").hidden = view !== "alerts"; $("forums-panel").dataset.alertFeed = String(view === "alerts");
        $("forum-result-count").textContent = loading ? (view === "alerts" ? "Loading reports…" : "Loading campus posts…") : `${filtered.length} ${view === "alerts" ? (filtered.length === 1 ? "report" : "reports") : (filtered.length === 1 ? "post" : "posts")}${cachedList ? " · Cached results" : ""}`;
        $("forum-search-scope").textContent = view === "saved" ? "Searches your saved posts" : view === "alerts" ? "Searches titles, details, reporters, and locations in this report list. Only verified, current alerts appear on the map." : "Searches titles, details, authors, and topics, including older posts";
        const visible = filtered.slice(0, shown), keep = new Set(visible.map(post => post.id));
        for (const [id, entry] of cards) if (!keep.has(id)) { entry.element.remove(); cards.delete(id); }
        for (const [index, post] of visible.entries()) {
            let entry = cards.get(post.id);
            if (!entry) {
                const element = node("article", "", "forum-feed-card"); element.id = `forum-card-${post.id}`;
                // The post surface is a generous pointer target; the title button
                // remains the keyboard entry point and Save stays independent.
                element.addEventListener("click", event => { if (!event.target.closest("button,a,input,textarea,select") && !window.getSelection?.()?.toString()) openPost(post.id); });
                const tag = node("span", "", "forum-card-topic forum-category"), open = button("", () => openPost(post.id), "forum-card-open"), heading = node("h3"); heading.append(open);
                const author = node("div", "", "forum-author-line"), face = avatar(post.name), name = node("strong"), meta = node("span", "", "forum-meta"); author.append(face, name, meta);
                const preview = node("p", "", "forum-card-preview"), helpful = node("div", "", "forum-helpful-preview"), helpfulFace = avatar(""), helpfulText = node("p"); helpful.append(helpfulFace, helpfulText);
                const footer = node("div", "", "forum-card-footer"), openReplies = button("", () => openPost(post.id), "forum-text-button", "chat"), save = button("Save", () => toggleSaved(post.id), "forum-card-save forum-text-button", "bookmark");
                footer.append(openReplies, save); element.append(tag, heading, author, preview, helpful, footer);
                entry = { element, tag, open, face, name, meta, preview, helpful, helpfulFace, helpfulText, openReplies, save }; cards.set(post.id, entry);
            }
            let label = post.topic || (post.category === "Comment" ? "Discussion" : post.category);
            entry.element.dataset.alert = String(post.category === "Alert");
            if (post.category === "Alert") { const status = alertStatus(post); label = alertLabels[status]; entry.element.dataset.alertStatus = status; }

            entry.tag.textContent = label; entry.tag.dataset.category = post.category;
            entry.open.firstElementChild.textContent = post.title; setAvatar(entry.face, post.name); entry.name.textContent = post.name;
            entry.meta.textContent = post.category === "Alert" ? `${post.location?.label || "Campus"} · ${post.verification ? "Checked" : "Reported"} ${date(post.verification?.approvedAt || post.createdAt)}` : date(post.createdAt); entry.meta.title = timestamp(post.createdAt) ? new Date(timestamp(post.createdAt)).toLocaleString() : "";
            entry.preview.textContent = post.body;
            const answer = post.acceptedAnswer; entry.helpful.hidden = !answer;
            if (answer) { const preview = answer.body.match(/^.+?[.!?](?=\s|$)/s)?.[0] || answer.body; setAvatar(entry.helpfulFace, answer.name); entry.helpfulText.replaceChildren(node("strong", `${answer.name.split(" ")[0]}: `), document.createTextNode(preview)); entry.helpful.setAttribute("aria-label", "Helpful reply selected by the author"); }
            entry.openReplies.lastElementChild.textContent = post.category === "Alert" ? "Read report" : `${post.replyCount || 0} ${post.replyCount === 1 ? "reply" : "replies"}`;
            entry.openReplies.setAttribute("aria-label", post.category === "Alert" ? `Read report: ${post.title}` : `Open ${post.title}, ${post.replyCount || 0} replies`); updateSave(entry.save, post.id, post.title);
            if (list.children[index] !== entry.element) list.insertBefore(entry.element, list.children[index] || null);
        }
        $("forum-empty").hidden = filtered.length > 0 || loading || listFailed;
        const constrained = !!(search.trim() || topic);
        $("forum-empty-title").textContent = constrained ? (view === "alerts" ? "No matching reports" : "No discussions match yet") : view === "saved" ? "Keep useful conversations here" : view === "alerts" ? ({ active: "No active alerts", mine: "No reports from you yet", review: "No reports awaiting review", history: "No past reports" }[alertFilter]) : "Start a campus conversation";
        $("forum-empty-description").textContent = constrained ? "Try another search or clear your filters." : view === "saved" ? "Save a discussion to find it here later." : view === "alerts" ? ({ active: "Verified, current alerts appear here and on the map. Pending reports are under review.", mine: "Use Report a problem to let campus know what happened.", review: "New reports and requests for more details appear here.", history: "Resolved, rejected, and out-of-date reports are kept here." }[alertFilter]) : "Ask a question or share something useful with campus.";
        $("forum-welcome-compose").hidden = constrained || view !== "discussions"; $("forum-empty-clear").hidden = !constrained;
        $("forum-list-placeholder").hidden = !loading || posts.length > 0; $("forum-load-more").hidden = filtered.length <= shown;
        $("forum-load-more").textContent = `Show more ${view === "alerts" ? "reports" : "posts"} (${Math.min(shown, filtered.length)} of ${filtered.length})`;
        if (!listFailed && (loading || cachedList)) feedback("forum-list-status", loading ? (view === "alerts" ? "Loading reports…" : "Loading discussions…") : `Offline or connecting · Showing available ${view === "alerts" ? "reports" : "discussions"}.`, "loading");
        if (focused?.isConnected && document.activeElement !== focused) window.CampusInput.focus(focused, { preventScroll: true });
        if (screen === "forum-welcome") restoreAnchor(position);
    }
    function listenPosts() {
        stopPosts?.(); const version = ++listVersion; loading = !posts.length; listFailed = false;
        feedback("forum-list-status", loading ? "Loading discussions…" : "Refreshing…", "loading"); $("forum-retry").setAttribute("aria-busy", "true"); $("forum-error-retry").hidden = true; renderPosts();
        stopPosts = service.watchAllPosts((data, cached) => {
            if (!active || disposed || version !== listVersion) return;
            posts = data; cachedList = cached; loading = cached && !data.length; listFailed = false; expiry.refresh(); renderPosts();
            if (!cached) feedback("forum-list-status", ""); $("forum-retry").setAttribute("aria-busy", String(cached)); $("forum-error-retry").hidden = true;
        }, error => {
            if (!active || disposed || version !== listVersion) return;
            loading = false; listFailed = true; feedback("forum-list-status", `${failure(error)}${posts.length ? " Showing previous results." : ""}`, "error");
            $("forum-retry").setAttribute("aria-busy", "false"); $("forum-error-retry").hidden = false; renderPosts();
        });
    }
    function listenSaved() {
        stopSaved?.(); const version = ++savedVersion; stopSaved = service.watchSavedPosts(user.uid, ids => {
            if (!active || disposed || version !== savedVersion) return;
            saved.clear(); ids.forEach(id => saved.add(id)); for (const [id, value] of pendingSaves) value ? saved.add(id) : saved.delete(id);
            renderPosts(); syncSaved();
        }, () => { if (active && !disposed && version === savedVersion) toast("Saved discussions could not sync. Reopen Forums to retry.", "error"); });
    }
    function updateSave(el, id, title = "this discussion") {
        el.lastElementChild.textContent = saved.has(id) ? "Saved" : "Save"; el.setAttribute("aria-pressed", String(saved.has(id))); el.classList.toggle("is-saved", saved.has(id));
        el.setAttribute("aria-label", `${saved.has(id) ? "Unsave" : "Save"} ${title}`); el.disabled = pendingSaves.has(id); el.setAttribute("aria-busy", String(pendingSaves.has(id)));
    }
    function syncSaved() { updateSave($("forum-save"), selected, currentPost?.title); $("forum-save").disabled = !currentPost || pendingSaves.has(selected); $("forum-copy-link").disabled = !currentPost; }
    async function toggleSaved(id) {
        if (!id || pendingSaves.has(id)) return;
        const wasSaved = saved.has(id); pendingSaves.set(id, !wasSaved); wasSaved ? saved.delete(id) : saved.add(id); renderPosts(); syncSaved();
        try { await service.setSavedPost(user, id, !wasSaved); if (!disposed) toast(wasSaved ? "Removed from saved discussions." : "Discussion saved to your account."); }
        catch { wasSaved ? saved.add(id) : saved.delete(id); if (!disposed) toast("Could not save this change. Please try again.", "error"); }
        finally { pendingSaves.delete(id); if (!disposed) { renderPosts(); syncSaved(); } }
    }
    function setReplyTarget(target) {
        replyTarget = target; $("forum-reply-target").hidden = !target; $("forum-reply-target-name").textContent = target ? `Replying to ${target.name}` : ""; $("forum-reply-input").placeholder = target ? `Reply to ${target.name}…` : "Add a reply…";
    }
    function replyControls() {
        const pending = replying();
        $("forum-reply-input").disabled = !currentPost || pending; $("forum-reply-submit").disabled = !currentPost || currentPost.pending || pending || !$("forum-reply-input").value.trim(); $("forum-reply-submit").setAttribute("aria-busy", String(pending)); $("forum-cancel-reply").disabled = pending;
        $("forum-reply-input").style.height = "auto"; $("forum-reply-input").style.height = `${Math.min(112, $("forum-reply-input").scrollHeight || 24)}px`;
    }
    function renderReplies() {
        const list = $("forum-reply-list"), position = anchor(list), focused = document.activeElement?.dataset?.replyControl;
        const order = $("forum-reply-sort").value, ordered = [...replies].sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt) || a.id.localeCompare(b.id)), tree = buildReplyTree(ordered);
        const containsAnswer = item => item.reply.id === currentPost?.acceptedReplyId || item.children.some(containsAnswer);
        if (order === "helpful") tree.sort((a, b) => Number(containsAnswer(b)) - Number(containsAnswer(a))); if (order === "newest") tree.reverse();
        const stack = tree.slice(0, replyShown).reverse().map(item => ({ ...item, depth: 0 })), items = [];
        while (stack.length) {
            const item = stack.pop(), reply = item.reply, li = node("li", "", "forum-reply"); li.id = `forum-reply-${reply.id}`; li.tabIndex = -1; li.style.setProperty("--reply-depth", Math.min(item.depth, 3)); li.dataset.nested = String(item.depth > 0);
            if (reply.parentId) li.setAttribute("aria-label", `${reply.name}, replying to ${replies.find(parent => parent.id === reply.parentId)?.name || "an earlier comment"}`);
            const content = node("div", "", "forum-reply-content"), meta = node("div", "", "forum-reply-meta"); meta.append(node("strong", reply.name), node("span", date(reply.createdAt), "forum-meta")); content.append(meta);
            if (currentPost?.acceptedReplyId === reply.id) { li.classList.add("is-answer"); content.append(node("span", "Helpful reply", "forum-answer-badge")); }
            content.append(node("p", reply.body, "forum-body")); const actions = node("div", "", "forum-reply-actions");
            const respond = button("Reply", () => { setReplyTarget({ id: reply.id, name: reply.name }); rememberReply(); window.CampusInput.focus($("forum-reply-input")); }, "forum-text-button", "reply");
            respond.dataset.replyControl = `respond-${reply.id}`; respond.setAttribute("aria-label", `Reply to ${reply.name}`); respond.disabled = replying() || reply.pending || !currentPost; actions.append(respond);
            if (item.children.length) { const toggle = button(collapsed.has(reply.id) ? `Show replies (${item.children.length})` : "Hide replies", () => { collapsed.has(reply.id) ? collapsed.delete(reply.id) : collapsed.add(reply.id); renderReplies(); }); toggle.dataset.replyControl = `collapse-${reply.id}`; toggle.setAttribute("aria-expanded", String(!collapsed.has(reply.id))); actions.append(toggle); }
            if (currentPost?.category === "Question" && currentPost.authorId === user.uid) {
                const chosen = currentPost.acceptedReplyId === reply.id;
                const accept = button(chosen ? "Unmark helpful" : "Mark helpful", async () => {
                    if (answerPending) return; const id = selected, version = threadVersion; answerPending = true; renderReplies();
                    try { await service.setAcceptedAnswer(user, id, chosen ? "" : reply.id); if (!disposed && version === threadVersion) toast(chosen ? "Helpful selection removed." : "Helpful reply selected."); }
                    catch (error) { if (!disposed && version === threadVersion) toast(error.message || "Could not save helpful reply.", "error"); }
                    finally { answerPending = false; if (!disposed) renderReplies(); }
                }); accept.dataset.replyControl = `accept-${reply.id}`; accept.disabled = answerPending || reply.pending || currentPost.pending; accept.setAttribute("aria-pressed", String(chosen)); actions.append(accept);
            }
            content.append(actions); li.append(avatar(reply.name), content); items.push(li);
            if (!collapsed.has(reply.id)) for (const child of [...item.children].reverse()) stack.push({ ...child, depth: item.depth + 1 });
        }
        list.replaceChildren(...items); $("forum-older-replies").hidden = tree.length <= replyShown;
        if (focused) [...list.querySelectorAll("[data-reply-control]")].find(el => el.dataset.replyControl === focused)?.focus({ preventScroll: true });
        if (screen === "forum-thread") restoreAnchor(position);
    }
    function listenReplies() {
        stopReplies?.(); const id = selected, version = threadVersion, replyEpoch = ++replyVersion; feedback("forum-replies-status", "Loading replies…", "loading"); $("forum-replies-retry").hidden = true;
        stopReplies = service.watchAllReplies(id, (data, cached) => {
            if (!active || disposed || version !== threadVersion || replyEpoch !== replyVersion || id !== selected || threadUnavailable) return;
            replies = data; renderReplies(); $("forum-replies-retry").hidden = true; feedback("forum-replies-status", cached ? "Connecting · Showing available replies." : data.length ? "" : "No replies yet. Be the first to help.", cached ? "loading" : "ready");
        }, error => { if (active && !disposed && version === threadVersion && replyEpoch === replyVersion && !threadUnavailable) { feedback("forum-replies-status", failure(error), "error"); $("forum-replies-retry").hidden = false; } });
    }
    function unavailable(message) {
        currentPost = null; replies = []; threadUnavailable = true; replyVersion++; stopReplies?.(); stopReplies = null;
        $("forum-thread-title").textContent = "Discussion unavailable"; $("forum-thread-loading").hidden = true;
        for (const id of ["forum-thread-body", "forum-thread-author", "forum-thread-avatar", "forum-thread-meta", "forum-thread-category", "forum-replies-status", "forum-action-status"]) $(id).textContent = "";
        $("forum-reply-heading").textContent = "Replies"; $("forum-reply-list").replaceChildren(); $("forum-older-replies").hidden = true; $("forum-replies-retry").hidden = true; $("forum-share-link").hidden = true;
        alerts.render(null); replyControls(); syncSaved(); feedback("forum-thread-status", message, "error");
    }
    function syncAlertDiscussion() {
        const isAlert = currentPost?.category === "Alert";
        $("alert-discussion-toggle").hidden = !isAlert;
        $("alert-discussion-toggle").textContent = `${alertDiscussion ? "Hide" : "Show"} discussion (${currentPost?.replyCount || 0})`;
        $("alert-discussion-toggle").setAttribute("aria-expanded", String(alertDiscussion));
        $("forum-replies").hidden = isAlert && !alertDiscussion;
        $("forum-reply-dock").hidden = screen !== "forum-thread" || isAlert && !alertDiscussion;
    }
    on("alert-discussion-toggle", "click", () => { alertDiscussion = !alertDiscussion; syncAlertDiscussion(); if (alertDiscussion) window.CampusInput.focus($("forum-reply-input")); });
    function openPost(id, push = true) {
        if (screen === "forum-welcome") listScroll = $("forum-content").scrollTop;
        rememberReply(); stopThread(); selected = id; lastOpened = id; currentPost = null; threadUnavailable = false; replies = []; replyShown = 20; collapsed.clear();
        alertDiscussion = false;
        const version = threadVersion; show("forum-thread"); syncAlertDiscussion(); setURL(id, push); syncSaved();
        $("forum-thread-title").textContent = "Loading discussion…"; $("forum-thread-title").focus({ preventScroll: true }); $("forum-thread-loading").hidden = false;
        for (const el of ["forum-thread-body", "forum-thread-author", "forum-thread-avatar", "forum-thread-meta", "forum-thread-category", "forum-thread-status", "forum-action-status", "forum-reply-status"]) $(el).textContent = "";
        $("forum-share-link").hidden = true; $("forum-reply-list").replaceChildren(); $("forum-reply-heading").textContent = "Replies";
        const draft = drafts.get(id); $("forum-reply-input").value = typeof draft?.body === "string" ? draft.body : ""; setReplyTarget(draft?.target || null); replyControls();
        stopPost = service.watchPost(id, post => {
            if (!active || disposed || version !== threadVersion) return;
            currentPost = post; $("forum-thread").classList.toggle("is-alert", post?.category === "Alert"); if (post?.category === "Alert") { view = "alerts"; syncNavigation(); } $("forum-back").lastChild.textContent = post?.category === "Alert" ? "Back to alerts" : "Back to discussions"; $("forum-thread-loading").hidden = true; alerts.render(post); replyControls();
            if (!post) { unavailable("This discussion is no longer available. Go back to find another conversation."); return; }
            feedback("forum-thread-status", "");
            $("forum-thread-title").textContent = post.title; $("forum-thread-category").textContent = post.topic || (post.category === "Comment" ? "Discussion" : post.category);
            $("forum-thread-author").textContent = post.name; setAvatar($("forum-thread-avatar"), post.name);
            $("forum-thread-meta").textContent = `${date(post.createdAt)}${post.pending ? " · Saving…" : ""}`; $("forum-thread-meta").title = timestamp(post.createdAt) ? new Date(timestamp(post.createdAt)).toLocaleString() : ""; $("forum-thread-body").textContent = post.body;
            $("forum-reply-heading").textContent = `Replies (${post.replyCount || 0})`; syncSaved(); renderReplies(); syncAlertDiscussion();
            if (threadUnavailable) { threadUnavailable = false; listenReplies(); }
        }, error => { if (!active || disposed || version !== threadVersion) return; unavailable(`${failure(error)} Go back and reopen this discussion.`); });
        listenReplies();
    }
    function back(updateURL = true) {
        rememberReply(); rememberCompose(); stopThread(); selected = null; currentPost = null; show("forum-welcome"); if (updateURL) setURL(null); renderPosts();
        $("forum-content").scrollTop = listScroll; (cards.get(lastOpened)?.open || $("forum-feed-title")).focus({ preventScroll: true });
    }
    function compose(isAlert = false) {
        if (isAlert) { view = "alerts"; topic = ""; syncNavigation(); }
        if (screen === "forum-welcome") listScroll = $("forum-content").scrollTop;
        if (posting) { rememberReply(); stopThread(); selected = null; setURL(null); show("forum-compose"); feedback("forum-compose-status", "Publishing…", "loading"); return; }
        rememberReply(); stopThread(); selected = null;
        if (isAlert) $("forum-category-input").value = "Alert"; else if ($("forum-category-input").value === "Alert") $("forum-category-input").value = "Question";
        setURL(null); show("forum-compose"); window.CampusInput.focus($("forum-title-input"));
    }
    for (const control of document.querySelectorAll("[data-alert-filter]")) control.addEventListener("click", () => {
        alertFilter = control.dataset.alertFilter;
        for (const item of document.querySelectorAll("[data-alert-filter]")) item.setAttribute("aria-pressed", String(item === control));
        filterChanged();
    }, { signal: events.signal });
    function filterChanged() { shown = 20; if (screen !== "forum-welcome") back(); $("forum-content").scrollTop = 0; renderPosts(); }
    function clearFilters() { search = ""; topic = ""; filterChanged(); }
    const navTopics = [["", "All discussions", "chat"], ["Study spaces", "Study spaces", "book"], ["Classes", "Classes", "mortarboard"], ["Campus life", "Campus life", "building"], ["Parking & transit", "Parking & transit", "car"], ["alerts", "Alerts", "alert"]];
    for (const [id, mobile] of [["forum-topic-nav", false], ["forum-mobile-topics", true]]) {
        $(id).replaceChildren(); for (const [value, label, symbol] of navTopics) { const el = button(mobile && !value ? "All" : label, () => { view = value === "alerts" ? "alerts" : "discussions"; topic = value === "alerts" ? "" : value; filterChanged(); }, mobile ? "forum-topic-chip" : "forum-nav-button", mobile ? null : symbol); el.dataset.forumTopic = value; $(id).append(el); }
    }
    $("forum-topic-input").replaceChildren(node("option", "Choose a topic")); $("forum-topic-input").firstElementChild.value = "";
    for (const value of topics) { const option = node("option", value); option.value = value; $("forum-topic-input").append(option); }
    $("forum-feed-title").tabIndex = -1; $("forum-post-form").reset();
    for (const id of [...composeFields, "forum-reply-input", "forum-post-submit"]) $(id).disabled = false;
    $("forum-post-submit").setAttribute("aria-busy", "false"); $("forum-reply-submit").setAttribute("aria-busy", "false");
    const composeDraft = read(":compose", {});
    if (composeDraft && typeof composeDraft === "object") for (const [id, value] of Object.entries(composeDraft)) if (composeFields.includes(id) && typeof value === "string") $(id).value = value;
    if (!$("forum-category-input").value) $("forum-category-input").value = "Question";
    setAvatar($("forum-compose-avatar"), user.displayName); $("forum-compose-avatar").dataset.tone = "self";
    for (const id of ["forum-search", "forum-mobile-search"]) on(id, "input", () => { search = $(id).value; filterChanged(); });
    for (const id of ["forum-sort", "forum-mobile-sort"]) on(id, "change", () => { sort = $(id).value; filterChanged(); });
    for (const id of ["forum-sidebar-saved", "forum-mobile-saved"]) on(id, "click", () => { view = view === "saved" ? "discussions" : "saved"; topic = ""; filterChanged(); });
    on("forum-empty-clear", "click", clearFilters); on("forum-category-input", "change", syncComposer); on("forum-reply-sort", "change", renderReplies);
    on("forum-post-form", "input", rememberCompose); on("forum-post-form", "change", rememberCompose);
    on("forum-reply-input", "input", () => { rememberReply(); replyControls(); if ($("forum-reply-status").dataset.state === "error") feedback("forum-reply-status", ""); });
    on("forum-cancel-reply", "click", () => { setReplyTarget(null); rememberReply(); window.CampusInput.focus($("forum-reply-input")); });
    on("forum-load-more", "click", () => { shown += 20; renderPosts(); }); on("forum-older-replies", "click", () => { replyShown += 20; renderReplies(); });
    for (const id of ["forum-retry", "forum-error-retry"]) on(id, "click", listenPosts); on("forum-replies-retry", "click", listenReplies);
    for (const id of ["forum-new-post", "forum-mobile-new", "forum-welcome-compose"]) on(id, "click", () => compose());
    for (const id of ["forum-new-alert", "forum-mobile-alert"]) on(id, "click", () => compose(true));
    on("forum-back", "click", () => back()); on("forum-cancel-post", "click", () => back()); on("forum-save", "click", () => toggleSaved(selected));
    on("forum-copy-link", "click", async () => {
        const version = threadVersion, url = postURL(location.href, selected), report = currentPost?.category === "Alert";
        try { await navigator.clipboard.writeText(url); if (!disposed && version === threadVersion) toast(report ? "Report link copied." : "Discussion link copied."); }
        catch { if (!disposed && version === threadVersion) { $("forum-share-link").value = url; $("forum-share-link").hidden = false; if (window.CampusInput.focus($("forum-share-link"))) $("forum-share-link").select(); feedback("forum-action-status", `Copy this link to share the ${report ? "report" : "discussion"}.`); } }
    });
    window.addEventListener(writeEvent, event => {
        const result = event.detail;
        if (disposed || result.uid !== user.uid) return;
        if (result.kind === "post") {
            const matches = sameCompose(composeValues(), result.values);
            if (!result.error && matches) { $("forum-post-form").reset(); alerts.reset(); rememberCompose(); feedback("forum-compose-status", ""); }
            if (result.error && matches) feedback("forum-compose-status", `Not submitted. Your draft is kept. ${result.error}`, "error");
            syncPostControls();
            if (!result.error && active && result.origin === instance && result.version === threadVersion) { openPost(result.id); toast(result.values["forum-category-input"] === "Alert" ? "Report submitted. Waiting for review." : "Post published."); }
            else if (!result.error && active) toast(result.values["forum-category-input"] === "Alert" ? "Report submitted. Waiting for review." : "Post published.");
            return;
        }
        if (!result.error) {
            clearSentDraft(result.id, result.body, result.target);
            if (selected === result.id && sameReply({ body: $("forum-reply-input").value, target: replyTarget }, result.body, result.target)) { $("forum-reply-input").value = ""; setReplyTarget(null); }
        }
        if (selected === result.id) {
            feedback("forum-reply-status", result.error ? `Reply not saved. Your draft is kept. ${result.error}` : "", result.error ? "error" : "ready");
            if (!result.error && active) {
                toast("Reply posted."); replyShown = replies.length; collapsed.clear();
                if (result.origin === instance && result.version === threadVersion) {
                    renderReplies(); $(`forum-reply-${result.replyId}`)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
                }
            }
        }
        replyControls(); renderReplies();
    }, { signal: events.signal });
    on("forum-post-form", "submit", async event => {
        event.preventDefault(); if (postOperations.has(user.uid) || disposed || !active) return;
        const values = composeValues(), result = { kind: "post", uid: user.uid, values, origin: instance, version: threadVersion };
        const draftKey = JSON.stringify(values); let submission = read(":submission", null);
        if (!submission || submission.key !== draftKey) { submission = { key: draftKey, id: service.newPostId() }; write(":submission", submission); }
        rememberCompose(); postOperations.set(user.uid, result); syncPostControls(); feedback("forum-compose-status", "Publishing…", "loading");
        try {
            result.id = await service.createPost(user, values["forum-title-input"], values["forum-body-input"], values["forum-category-input"], alerts.location(), values["forum-topic-input"], { issueType: values["alert-issue-type"], submissionId: submission.id });
            if (sameCompose(read(":compose", {}), values)) { try { sessionStorage.removeItem(key + ":compose"); sessionStorage.removeItem(key + ":submission"); } catch { /* Optional persistence unavailable. */ } }
        } catch (error) { result.error = error.message || failure(error); }
        finally { postOperations.delete(user.uid); window.dispatchEvent(new CustomEvent(writeEvent, { detail: result })); }
    });
    on("forum-reply-form", "submit", async event => {
        event.preventDefault(); if (replying() || disposed || !active || !currentPost || currentPost.pending || !$("forum-reply-input").value.trim()) return;
        const id = selected, body = $("forum-reply-input").value, target = replyTarget;
        const result = { kind: "reply", uid: user.uid, id, body, target, origin: instance, version: threadVersion };
        rememberReply(); replyOperations.set(replyOperationKey(id), result); replyControls(); renderReplies(); feedback("forum-reply-status", "Sending reply…", "loading");
        try { result.replyId = await service.sendReply(user, id, body, target?.id || ""); clearSentDraft(id, body, target); }
        catch (error) { result.error = error.message || failure(error); }
        finally { replyOperations.delete(replyOperationKey(id)); window.dispatchEvent(new CustomEvent(writeEvent, { detail: result })); }
    });
    // Keep the mobile reply dock within the visible area above the software keyboard.
    function viewport() { const v = window.CampusInput.getViewport(); $("chat-panel").style.setProperty("--forum-viewport-height", `${v.height}px`); $("chat-panel").style.setProperty("--forum-viewport-offset", `${v.offset}px`); }
    window.addEventListener("campus-input-viewport", viewport, { signal: events.signal }); viewport();
    window.addEventListener("popstate", () => { if (!active || disposed) return; const id = postIdFromURL(location.href); id ? openPost(id, false) : back(false); }, { signal: events.signal });
    window.addEventListener("pagehide", () => { rememberReply(); rememberCompose(); }, { signal: events.signal });
    show("forum-welcome"); syncPostControls(); renderPosts();
    return {
        setActive(value) {
            if (disposed || active === value) return; active = value; expiry.refresh();
            if (value) { listenPosts(); listenSaved(); const id = postIdFromURL(location.href); if (id) openPost(id, false); else if (screen === "forum-thread") back(false); else show(screen, false); }
            else { closeFilters(); rememberReply(); rememberCompose(); listVersion++; savedVersion++; stopPosts?.(); stopSaved?.(); stopThread(); alerts.setComposer(false); }
        },
        dispose() { closeFilters(); rememberReply(); rememberCompose(); disposed = true; active = false; listVersion++; savedVersion++; stopPosts?.(); stopSaved?.(); stopThread(); alerts.dispose(); expiry.dispose(); events.abort(); clearTimeout(toastTimer); $("forum-toast").hidden = true; }
    };
}
