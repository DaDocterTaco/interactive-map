const chatPanel = document.getElementById("chat-panel");
const openButton = document.getElementById("open-chat");
const closeButton = document.getElementById("close-chat");
const clearButton = document.getElementById("clear-chat");
const sendButton = document.getElementById("send-message");
const chatStatus = document.getElementById("chat-status");
const connectionStatus = document.getElementById("connection-status");
const namePanel = document.getElementById("name-panel");
const nameForm = document.getElementById("name-form");
const nameInput = document.getElementById("name-input");
const joinButton = document.getElementById("join-chat");
const cancelButton = document.getElementById("cancel-name");
const nameError = document.getElementById("name-error");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageList = document.getElementById("message-list");
const messageStatus = document.getElementById("message-status");

let authModule;
let chatService;
let groupService;
let groupController;
let peopleController;
let forumController;
let activeSection = "chats";
let currentGroup = null;
let stopRequests;
const drafts = new Map();
let currentUser = null;
let stopMessages;
let viewVersion = 0;
let joining = false;
let sending = false;
let clearing = false;
let ready = false;
let fromCache = true;
let isModerator = false;
let stopModerator;
let latestMessages = [];
let removalButtons = [];
let removing = false;
let closing = false;
let closeTimer;
let hasRenderedMessages = false;
let hasReceivedServerMessages = false;
let unseenMessages = 0;
let pendingModeration;
let timesPinned = false;
let timeGesture = null;
const GROUP_GAP_MS = 2 * 60 * 1000;
const TIME_BREAK_MS = 60 * 60 * 1000;
const TIME_REVEAL_WIDTH = 64;
const messageElements = new Map();
const dateElements = new Map();
const el = id => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const chatOptions = el("chat-options");
const moreButton = el("chat-more");
const retryButton = el("message-retry") || Object.assign(document.createElement("button"), {
    id: "message-retry", type: "button", textContent: "Try again", hidden: true
});
if (!retryButton.isConnected) messageStatus.after(retryButton);
const newMessageButton = el("new-message-indicator") || Object.assign(document.createElement("button"), {
    id: "new-message-indicator", type: "button", hidden: true
});
if (!newMessageButton.isConnected) messageList.after(newMessageButton);
const messageAnnouncer = el("message-announcer") || Object.assign(document.createElement("p"), {
    id: "message-announcer", className: "community-sr-only"
});
messageAnnouncer.setAttribute("role", "status");
messageAnnouncer.setAttribute("aria-live", "polite");
if (!messageAnnouncer.isConnected) messageStatus.after(messageAnnouncer);
// Announce only new arrivals, rather than reading the initial shared history.
messageList.setAttribute("aria-live", "off");
messageList.setAttribute("aria-keyshortcuts", "T");
messageList.setAttribute("aria-description", "Swipe left to peek at message times. Press T or use Chat options to show or hide them.");

function updateTimeToggle() {
    const toggle = el("toggle-message-times");
    if (!toggle) return;
    const label = timesPinned ? "Hide message times" : "Show message times";
    toggle.setAttribute("aria-pressed", String(timesPinned));
    toggle.setAttribute("aria-controls", "message-list");
    const copy = toggle.querySelector("[data-message-times-label]");
    if (copy) setText(copy, label); else setText(toggle, label);
}
function stopTimeGesture() {
    const gesture = timeGesture;
    timeGesture = null;
    messageList.classList.remove("is-time-dragging", "times-peeking");
    messageList.style.setProperty("--time-reveal", "0px");
    messageList.style.setProperty("--time-opacity", "0");
    if (gesture && messageList.hasPointerCapture?.(gesture.id)) messageList.releasePointerCapture(gesture.id);
}
function setTimesPinned(pinned, preserveScroll = true) {
    const nearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
    const listTop = messageList.getBoundingClientRect().top;
    const anchor = preserveScroll && !nearBottom && [...messageList.children].find(row => row.classList.contains("message-row") && row.getBoundingClientRect().bottom > listTop);
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - listTop : 0;
    stopTimeGesture();
    timesPinned = pinned;
    messageList.classList.toggle("times-visible", pinned);
    for (const row of messageElements.values()) row.parts.time.setAttribute("aria-hidden", String(!pinned));
    updateTimeToggle();
    if (!preserveScroll) return;
    if (nearBottom) messageList.scrollTop = messageList.scrollHeight;
    else if (anchor?.isConnected) messageList.scrollTop += anchor.getBoundingClientRect().top - listTop - anchorOffset;
}
el("toggle-message-times")?.addEventListener("click", () => setTimesPinned(!timesPinned));
messageList.addEventListener("keydown", event => {
    if (event.target !== messageList || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() === "t") {
        event.preventDefault(); setTimesPinned(!timesPinned);
    } else if (event.key === "Escape" && timesPinned) {
        event.preventDefault(); event.stopPropagation(); setTimesPinned(false);
    }
});
messageList.addEventListener("pointerdown", event => {
    stopTimeGesture();
    if (timesPinned || !messageElements.size || event.isPrimary === false || event.button !== 0
        || event.target.closest("button, a, input, textarea, select")) return;
    timeGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
});
messageList.addEventListener("pointermove", event => {
    if (!timeGesture || timeGesture.id !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) { stopTimeGesture(); return; }
    const dx = event.clientX - timeGesture.x;
    const dy = event.clientY - timeGesture.y;
    if (!timeGesture.horizontal) {
        // Let normal vertical scrolling and rightward movement win immediately.
        // Only a clear leftward intent takes pointer capture.
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx) || dx > 8) { stopTimeGesture(); return; }
        if (dx > -10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        timeGesture.horizontal = true;
        messageList.setPointerCapture?.(event.pointerId);
        messageList.classList.add("is-time-dragging", "times-peeking");
    }
    event.preventDefault();
    const distance = Math.max(0, Math.min(TIME_REVEAL_WIDTH, -dx));
    messageList.style.setProperty("--time-reveal", `${distance}px`);
    messageList.style.setProperty("--time-opacity", String(Math.min(1, distance / 48)));
}, { passive: false });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) messageList.addEventListener(type, event => {
    if (timeGesture?.id === event.pointerId) stopTimeGesture();
});
updateTimeToggle();

function readPreference(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function savePreference(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Preferences remain usable in this tab. */ }
}
function applyTheme(theme) {
    document.documentElement.dataset.chatTheme = theme;
    const toggle = el("theme-toggle");
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    toggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
    toggle.title = toggle.getAttribute("aria-label");
    const label = toggle.querySelector("[data-theme-label]");
    if (label) label.textContent = theme === "dark" ? "Dark mode" : "Light mode";
}
applyTheme(readPreference("fiu-chat:theme") === "dark" ? "dark"
    : readPreference("fiu-chat:theme") === "light" ? "light" : systemTheme.matches ? "dark" : "light");
systemTheme.addEventListener("change", event => {
    if (!["light", "dark"].includes(readPreference("fiu-chat:theme"))) applyTheme(event.matches ? "dark" : "light");
});
el("theme-toggle")?.addEventListener("click", () => {
    const theme = document.documentElement.dataset.chatTheme === "dark" ? "light" : "dark";
    savePreference("fiu-chat:theme", theme);
    applyTheme(theme);
});

function setMobileView(view, remember = true) {
    chatPanel.dataset.mobileView = view;
    if (remember) savePreference("fiu-chat:mobile-view", view);
}
function setMenu(open, returnFocus = false) {
    if (!chatOptions || !moreButton) return;
    chatOptions.hidden = !open;
    moreButton.setAttribute("aria-expanded", String(open));
    if (open) chatOptions.querySelector("button:not([hidden]):not(:disabled)")?.focus();
    else if (returnFocus) moreButton.focus();
}
moreButton?.addEventListener("click", () => setMenu(chatOptions.hidden));
document.addEventListener("click", event => {
    if (chatOptions && !chatOptions.hidden && !chatOptions.contains(event.target) && !moreButton.contains(event.target)) setMenu(false);
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && chatOptions && !chatOptions.hidden) {
        event.preventDefault(); event.stopPropagation(); setMenu(false, true);
    }
}, true);
chatOptions?.addEventListener("click", event => {
    if (event.target.closest("button")) setMenu(false);
});
el("back-to-chats")?.addEventListener("click", () => {
    setMenu(false); setMobileView("list"); el("chat-search").focus({ preventScroll: true });
});
el("profile-button")?.addEventListener("click", () => {
    if (!currentUser) return;
    el("profile-display-name").textContent = currentUser.displayName;
    el("profile-user-id").textContent = currentUser.uid;
    el("profile-panel").showModal();
});
el("close-profile")?.addEventListener("click", () => el("profile-panel").close());

function initials(name) {
    const value = String(name || "?").trim() || "?";
    const words = value.split(/\s+/);
    const camelWords = value.match(/[A-Z][a-z]+/g);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0]
        : camelWords?.length > 1 ? camelWords[0][0] + camelWords[camelWords.length - 1][0]
        : value.slice(0, 2);
    return letters.toUpperCase();
}
function avatarTone(name) {
    let hash = 0;
    for (const letter of String(name || "")) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
    return hash % 5;
}
function statusMessage(text, state = "") {
    messageStatus.textContent = text;
    messageStatus.dataset.state = state;
    messageStatus.dataset.kind = text === "Sent" ? "delivery" : "";
}
function connectionMessage(text, state) {
    connectionStatus.textContent = text;
    connectionStatus.dataset.state = state;
}
function focusComposer() {
    if (activeSection === "chats" && !window.matchMedia("(max-width: 700px)").matches) messageInput.focus({ preventScroll: true });
}
function scrollToLatest() {
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: reducedMotion.matches ? "instant" : "smooth" });
    unseenMessages = 0; newMessageButton.hidden = true;
}
newMessageButton.addEventListener("click", scrollToLatest);
messageList.addEventListener("scroll", () => {
    if (messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80) {
        unseenMessages = 0; newMessageButton.hidden = true;
    }
}, { passive: true });
retryButton.addEventListener("click", () => messageForm.requestSubmit());

function askModeration({ title, description, action }) {
    const panel = el("moderation-panel");
    if (!panel || pendingModeration) return Promise.resolve(null);
    el("moderation-title").textContent = title;
    el("moderation-description").textContent = description;
    el("moderation-confirm").textContent = action;
    el("moderation-reason").value = "";
    el("moderation-error").textContent = "";
    panel.showModal();
    el("moderation-reason").focus();
    return new Promise(resolve => { pendingModeration = resolve; });
}
function finishModeration(reason = null) {
    const resolve = pendingModeration;
    pendingModeration = null;
    el("moderation-panel")?.close();
    resolve?.(reason);
}
el("moderation-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const reason = el("moderation-reason").value.trim();
    if (!reason || reason.length > 300) {
        el("moderation-error").textContent = "Enter a reason between 1 and 300 characters.";
        el("moderation-reason").focus(); return;
    }
    finishModeration(reason);
});
el("moderation-cancel")?.addEventListener("click", () => finishModeration());
el("moderation-panel")?.addEventListener("close", () => {
    const resolve = pendingModeration; pendingModeration = null; resolve?.(null);
});

function disconnectModerator() {
    stopModerator?.();
    stopModerator = null;
    isModerator = false;
    if (el("moderation-status")) el("moderation-status").textContent = "";
    updateControls();
}

function selectSection(section) {
    activeSection = section;
    chatPanel.dataset.section = section;
    setMenu(false);
    stopTimeGesture();
    const forums = section === "forums";
    document.getElementById("chats-tab").setAttribute("aria-pressed", String(!forums));
    document.getElementById("forums-tab").setAttribute("aria-pressed", String(forums));
    document.getElementById("chats-sidebar").hidden = forums;
    document.getElementById("chats-conversation").hidden = forums;
    document.getElementById("forums-panel").hidden = !forums;
    document.getElementById("forums-sidebar").hidden = !forums;
    forumController?.setActive(forums);
    chatPanel.dispatchEvent(new CustomEvent("community-section-change", { detail: { section } }));
}
document.getElementById("chats-tab").addEventListener("click", () => selectSection("chats"));
document.getElementById("forums-tab").addEventListener("click", () => selectSection("forums"));

async function loadAuth() {
    if (location.protocol === "file:") {
        throw new Error("Open this page through a local web server (such as VS Code Live Server), not by double-clicking the HTML file.");
    }
    if (!authModule) {
        const module = await import("./chatAuth.js");
        await module.restoreUser();
        module.watchUser((user) => {
            if (currentUser && currentUser.uid !== user?.uid) {
                currentUser = null;
                drafts.clear();
                disconnectMessages();
                messageList.replaceChildren();
                messageInput.value = "";
                chatPanel.close();
                chatStatus.textContent = "Your sign-in changed. Open chat again to continue.";
            }
        });
        authModule = module;
    }
    return authModule;
}

function errorMessage(error) {
    switch (error.code) {
        case "auth/operation-not-allowed":
        case "auth/admin-restricted-operation":
            return "Chat sign-in is temporarily unavailable. Please try again later.";
        case "auth/configuration-not-found":
            return "Chat sign-in is temporarily unavailable. Please try again later.";
        case "auth/network-request-failed":
        case "unavailable":
            return "You appear to be offline. Check your connection and try again.";
        case "permission-denied":
            return "You no longer have access to this conversation, or the group has closed. Reopen chat to retry.";
        case "not-found":
            return "This conversation is unavailable. Reopen chat to retry.";
        case "auth/unauthorized-domain":
            return "Sign-in is unavailable from this website. Please contact the app organizer.";
        case "auth/web-storage-unsupported":
            return "Allow this website to store browser data so it can remember your sign-in.";
        case "auth/too-many-requests":
            return "Too many sign-in attempts. Please wait a moment and try again.";
        default:
            return error.message && !/Firebase|Firestore/i.test(error.message) ? error.message : "Could not connect. Please try again.";
    }
}

function updateControls() {
    sendButton.disabled = !ready || sending || clearing || removing;
    clearButton.hidden = !isModerator || !!currentGroup;
    clearButton.disabled = !isModerator || !ready || fromCache || sending || clearing || removing;
    messageInput.disabled = !ready || sending || clearing || removing;
    sendButton.textContent = sending ? "Sending…" : "Send";
    sendButton.classList.toggle("is-sending", sending);
    messageForm.setAttribute("aria-busy", String(sending));
    retryButton.disabled = !ready || sending || clearing || removing;
    removalButtons.forEach(button => { button.disabled = !isModerator || !ready || fromCache || sending || clearing || removing; });
}

function disconnectMessages() {
    viewVersion++;
    if (stopMessages) stopMessages();
    stopMessages = null;
    if (stopRequests) stopRequests();
    stopRequests = null;
    document.getElementById("access-requests").replaceChildren();
    ready = false;
    setTimesPinned(false, false);
    latestMessages = [];
    messageElements.clear();
    dateElements.clear();
    hasRenderedMessages = false;
    hasReceivedServerMessages = false;
    unseenMessages = 0;
    newMessageButton.hidden = true;
    retryButton.hidden = true;
    removalButtons = [];
    updateControls();
}

function discardOldLocalHistory() {
    // The old local demo must never reappear or be uploaded as shared history.
    try {
        localStorage.removeItem(`fiu-chat:campus-public:${currentUser.uid}:messages`);
    } catch { /* Firestore works even if old local storage cannot be removed. */ }
}

function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
}
function messageDate(message) {
    const date = message.createdAt?.toDate?.();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}
function dateLabel(date) {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric",
        ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}
function clockLabel(date) { return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function sameMessageRun(previous, current, previousDate, currentDate) {
    if (!previous || !current || previous.senderId !== current.senderId || !previousDate || !currentDate) return false;
    const elapsed = currentDate.getTime() - previousDate.getTime();
    return previousDate.toDateString() === currentDate.toDateString() && elapsed >= 0 && elapsed <= GROUP_GAP_MS;
}
function renderMessagePlaceholder(title, detail, loading = false) {
    const item = document.createElement("li");
    item.className = "message-empty" + (loading ? " message-placeholder" : "");
    const icon = document.createElement("span");
    icon.className = "empty-chat-icon icon icon-chat";
    icon.setAttribute("aria-hidden", "true");
    const heading = document.createElement("strong"); heading.textContent = title;
    const hint = document.createElement("span"); hint.textContent = detail;
    item.append(icon, heading, hint);
    messageList.replaceChildren(item);
}
async function removeMessage(message, version, groupId) {
    if (version !== viewVersion || !isModerator || !ready || fromCache || sending || clearing || removing) return;
    const reason = await askModeration({
        title: "Remove this message?",
        description: `This removes ${message.name}’s message for everyone. This cannot be undone. Your reason is recorded with the moderation action.`,
        action: "Remove message"
    });
    if (reason === null || version !== viewVersion || !isModerator || !ready || fromCache || sending || clearing || removing) return;
    removing = true;
    updateControls();
    statusMessage("Removing message…", "loading");
    try {
        await chatService.removeMessage(currentUser, message.id, reason, groupId);
        if (version === viewVersion) statusMessage("Message removed. Your moderation action was recorded.", "success");
    } catch (error) {
        if (version === viewVersion) statusMessage(`Message not removed. ${errorMessage(error)}`, "error");
    } finally {
        removing = false;
        updateControls();
    }
}
function createMessageRow(message, animate) {
    const item = document.createElement("li");
    item.className = "message-row";
    item.dataset.messageId = message.id;
    const avatar = document.createElement("span"); avatar.className = "message-avatar avatar";
    avatar.setAttribute("aria-hidden", "true");
    const content = document.createElement("div"); content.className = "message-content";
    const meta = document.createElement("div"); meta.className = "message-meta";
    const name = document.createElement("span"); name.className = "message-name";
    const time = document.createElement("time"); time.className = "message-time";
    meta.append(name);
    const bubble = document.createElement("div"); bubble.className = "message-bubble";
    const delivery = document.createElement("span"); delivery.className = "message-delivery";
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "remove-message"; remove.textContent = "Remove";
    remove.hidden = true;
    const version = viewVersion;
    const groupId = currentGroup?.id;
    remove.addEventListener("click", () => removeMessage(item.messageData, version, groupId));
    content.append(meta, bubble, delivery, remove);
    item.append(avatar, content, time);
    item.parts = { avatar, content, meta, name, time, bubble, delivery, remove };
    if (animate && !reducedMotion.matches) {
        item.classList.add("message-enter");
        item.addEventListener("animationend", () => item.classList.remove("message-enter"), { once: true });
    }
    return item;
}
function renderMessages(messages, historical = false) {
    latestMessages = messages;
    removalButtons = [];
    const nearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
    const previousScroll = messageList.scrollTop;
    const previousHeight = messageList.scrollHeight;
    const listTop = messageList.getBoundingClientRect().top;
    const anchor = !nearBottom && [...messageList.children].find(row => row.classList.contains("message-row") && row.getBoundingClientRect().bottom > listTop);
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - listTop : 0;
    const desired = [];
    const visibleIds = new Set();
    const visibleDates = new Set();
    const additions = [];
    const dates = messages.map(messageDate);
    let lastOwnId = null;
    for (const message of messages) if (message.senderId === currentUser?.uid) lastOwnId = message.id;
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        const own = message.senderId === currentUser?.uid;
        const date = dates[index];
        const previousDate = dates[index - 1];
        const elapsed = date && previousDate ? date.getTime() - previousDate.getTime() : 0;
        const dayChanged = !!date && (!previousDate || date.toDateString() !== previousDate.toDateString());
        const hasSeparator = index === 0 || dayChanged || elapsed >= TIME_BREAK_MS;
        const continuation = sameMessageRun(messages[index - 1], message, previousDate, date);
        const continuesNext = sameMessageRun(message, messages[index + 1], date, dates[index + 1]);
        if (hasSeparator) {
            // Multiple pauses can occur on one day. Key the separator to its
            // following message so metadata changes retain the same DOM node.
            let separator = dateElements.get(message.id);
            if (!separator) {
                separator = document.createElement("li"); separator.className = "message-date";
                const label = document.createElement("span"); separator.appendChild(label);
                dateElements.set(message.id, separator);
            }
            const label = date ? (index === 0 || dayChanged ? `${dateLabel(date)} · ${clockLabel(date)}` : clockLabel(date))
                : message.pending ? "Sending…" : "Messages";
            setText(separator.firstElementChild, label);
            separator.dataset.beforeMessage = message.id;
            visibleDates.add(message.id); desired.push(separator);
        }
        let item = messageElements.get(message.id);
        if (!item) {
            item = createMessageRow(message, hasRenderedMessages && !historical);
            messageElements.set(message.id, item);
            if (hasRenderedMessages && !historical) additions.push(message);
        }
        item.messageData = message;
        const parts = item.parts;
        item.classList.toggle("own", own);
        item.classList.toggle("pending", !!message.pending);
        item.classList.toggle("message-continuation", continuation);
        item.classList.toggle("message-group-start", !continuation);
        item.classList.toggle("message-group-end", !continuesNext);
        item.classList.toggle("message-gap", elapsed > GROUP_GAP_MS);
        parts.avatar.hidden = own;
        parts.avatar.className = `message-avatar avatar avatar-tone-${avatarTone(message.name)}`;
        parts.meta.hidden = own || continuation;
        setText(parts.avatar, initials(message.name));
        setText(parts.name, own ? "You" : message.name || "Campus member");
        setText(parts.time, date ? clockLabel(date) : "Pending");
        parts.time.setAttribute("aria-hidden", String(!timesPinned));
        const exactTime = date ? date.toLocaleString() : "Time pending";
        parts.time.title = exactTime;
        parts.time.setAttribute("aria-label", exactTime);
        parts.bubble.title = exactTime;
        if (date) parts.time.dateTime = date.toISOString(); else parts.time.removeAttribute("datetime");
        setText(parts.bubble, message.text || "");
        parts.delivery.hidden = !own || (!message.pending && lastOwnId !== message.id);
        setText(parts.delivery, message.pending ? "Sending…" : "Sent");
        parts.remove.hidden = !isModerator || currentGroup?.visibility === "direct" || !!message.pending;
        parts.remove.setAttribute("aria-label", `Remove message by ${message.name}`);
        if (!parts.remove.hidden) removalButtons.push(parts.remove);
        visibleIds.add(message.id); desired.push(item);
    }
    for (const [id, row] of messageElements) if (!visibleIds.has(id)) { row.remove(); messageElements.delete(id); }
    for (const [day, separator] of dateElements) if (!visibleDates.has(day)) { separator.remove(); dateElements.delete(day); }
    if (!messages.length) {
        renderMessagePlaceholder("Start the conversation", currentGroup?.visibility === "direct"
            ? "Say hello. Your messages are just between you two."
            : "Say hello, ask a question, or share what’s happening on campus.");
    } else {
        const desiredSet = new Set(desired);
        for (const child of [...messageList.children]) if (!desiredSet.has(child)) child.remove();
        // Keep existing rows in place so snapshot metadata updates neither replay
        // animations nor remove keyboard focus from a moderation button.
        let cursor = messageList.firstChild;
        for (const row of desired) {
            if (row === cursor) cursor = cursor.nextSibling;
            else messageList.insertBefore(row, cursor);
        }
    }
    if (nearBottom || !hasRenderedMessages || additions.some(message => message.senderId === currentUser?.uid)) {
        messageList.scrollTop = messageList.scrollHeight;
        unseenMessages = 0; newMessageButton.hidden = true;
    } else if (anchor?.isConnected) {
        messageList.scrollTop = previousScroll + anchor.getBoundingClientRect().top - listTop - anchorOffset;
    } else {
        messageList.scrollTop = previousScroll + messageList.scrollHeight - previousHeight;
    }
    const incoming = additions.filter(message => message.senderId !== currentUser?.uid);
    if (incoming.length) {
        messageAnnouncer.textContent = incoming.length === 1
            ? `${incoming[0].name}: ${incoming[0].text}` : `${incoming.length} new messages.`;
        if (!nearBottom) {
            unseenMessages += incoming.length;
            newMessageButton.textContent = `${unseenMessages} new message${unseenMessages === 1 ? "" : "s"} ↓`;
            newMessageButton.hidden = false;
        }
    }
    hasRenderedMessages = true;
    updateControls();
}

function updateGroup(group) {
    if (group.visibility === "direct") return;
    if (currentGroup?.id !== group.id) return;
    currentGroup = group;
    const closed = groupService.isClosed(group);
    document.getElementById("group-settings").hidden = closed || group.creatorId !== currentUser.uid;
    el("customize-group").hidden = closed || group.creatorId !== currentUser.uid;
    if (el("conversation-avatar")) groupController?.renderAppearance?.(el("conversation-avatar"), group);
    document.getElementById("group-expiry").textContent = closed
        ? "This group was deleted by its owner."
        : "";
    if (closed) {
        peopleController?.setConversation(null);
        disconnectMessages();
        renderMessagePlaceholder("This group was deleted", "Its owner removed it. Choose another conversation from your chats.");
        connectionMessage("This group was deleted.", "closed");
    }
}

function renderRequests(requests, group, version) {
    const container = document.getElementById("access-requests");
    container.replaceChildren();
    for (const request of requests) {
        const card = document.createElement("div");
        card.className = "access-request";
        const text = document.createElement("p");
        text.textContent = `${request.name} wants to join.`;
        card.appendChild(text);
        const buttons = [];
        for (const accept of [true, false]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = accept ? "Accept" : "Deny";
            buttons.push(button);
            button.addEventListener("click", async () => {
                buttons.forEach(item => { item.disabled = true; });
                try {
                    await groupService.decideRequest(group.id, request.id, currentUser, accept);
                    if (version === viewVersion) statusMessage(accept ? `${request.name} can now join this chat.` : `Access request from ${request.name} declined.`, "success");
                }
                catch (error) {
                    if (version === viewVersion) { text.textContent = `${request.name}: ${errorMessage(error)}`; buttons.forEach(item => { item.disabled = false; }); }
                }
            });
            card.appendChild(button);
        }
        container.appendChild(card);
    }
}

function selectConversation(group, { reveal = true } = {}) {
    drafts.set(currentGroup?.id || "Campus Chat", messageInput.value);
    disconnectMessages();
    const version = viewVersion;
    currentGroup = group;
    setMenu(false);
    if (reveal) setMobileView("conversation");
    peopleController?.setConversation(group);
    messageInput.value = drafts.get(group?.id || "Campus Chat") || "";
    renderMessagePlaceholder("Opening conversation", "Getting your latest messages…", true);
    statusMessage("");
    messageAnnouncer.textContent = "";
    document.getElementById("chat-title").textContent = group ? group.name : "Campus Chat";
    const subtitle = group?.visibility === "direct" ? "Private · Just the two of you"
        : group?.visibility === "private" ? "Private · Members only"
        : group ? "Public · Open to everyone" : "Public · Everyone on campus";
    if (el("chat-subtitle")) el("chat-subtitle").textContent = subtitle;
    const avatar = el("conversation-avatar");
    if (avatar) {
        avatar.className = group ? `avatar avatar-tone-${avatarTone(group.name)}` : "avatar campus-avatar";
        if (group) avatar.textContent = initials(group.name);
        else {
            const icon = document.createElement("span"); icon.className = "icon icon-people"; icon.setAttribute("aria-hidden", "true");
            avatar.replaceChildren(icon);
        }
    }
    messageInput.placeholder = `Message ${group?.name || "Campus Chat"}…`;
    document.getElementById("group-settings").hidden = true;
    el("customize-group").hidden = true;
    document.getElementById("group-expiry").textContent = "";
    document.getElementById("chat-help").textContent = "Latest 100 messages";
    updateControls();
    connectionMessage("Connecting…", "loading");
    if (group && group.visibility !== "direct") {
        updateGroup(group);
        if (groupService.isClosed(group)) return;
    }
    stopMessages = chatService.watchMessages((messages, cached) => {
        if (version !== viewVersion) return;
        ready = true;
        fromCache = cached;
        renderMessages(messages, !hasReceivedServerMessages);
        if (!cached) hasReceivedServerMessages = true;
        connectionMessage(cached ? "Reconnecting… New messages will send when connected." : "Connected", cached ? "offline" : "connected");
        updateControls();
    }, error => {
        if (version !== viewVersion) return;
        ready = false;
        connectionMessage(errorMessage(error), "error");
        if (!latestMessages.length) renderMessagePlaceholder("Unable to load messages", "Close and reopen chat to try again. Your draft is kept.");
        updateControls();
    }, group?.id);
    if (group?.visibility === "private") stopRequests = groupService.watchRequests(group.id, requests => {
        if (version === viewVersion) renderRequests(requests, group, version);
    }, error => {
        if (version === viewVersion) document.getElementById("access-requests").textContent = `Access requests unavailable: ${errorMessage(error)}`;
    });
    focusComposer();
}

async function showChat(user) {
    disconnectModerator();
    disconnectMessages();
    groupController?.dispose();
    peopleController?.dispose(); peopleController = null;
    forumController?.dispose();
    forumController = null;
    selectSection("chats");
    const version = viewVersion;
    currentUser = user;
    document.getElementById("chat-identity").textContent = "";
    if (el("profile-name")) el("profile-name").textContent = user.displayName;
    if (el("profile-initials")) el("profile-initials").textContent = initials(user.displayName);
    setMobileView(readPreference("fiu-chat:mobile-view") === "list" ? "list" : "conversation", false);
    clearTimeout(closeTimer); closing = false; chatPanel.classList.remove("is-closing");
    renderMessagePlaceholder("Opening your chats", "Getting your conversations ready…", true);
    connectionMessage("Connecting…", "loading");
    discardOldLocalHistory();
    if (!chatPanel.open) chatPanel.showModal();
    try {
        const modules = await Promise.all([import("./chatService.js"), import("./groups.js"), import("./groupUI.js"), import("./forums/forumUI.js"), import("./people.js"), import("./peopleUI.js")]);
        await modules[4].saveProfile(user);
        if (version !== viewVersion || !chatPanel.open) return;
        [chatService, groupService] = modules;
        let disposed = false;
        const stop = chatService.watchModerator(user.uid, enabled => {
            if (disposed || currentUser?.uid !== user.uid || !chatPanel.open) return;
            isModerator = enabled;
            document.getElementById("moderation-status").textContent = enabled ? "Chat moderator" : "";
            if (ready) renderMessages(latestMessages);
            else updateControls();
        }, () => {
            if (!disposed && chatPanel.open) document.getElementById("moderation-status").textContent = "Moderator access could not be checked. Reopen chat to retry.";
        });
        stopModerator = () => { disposed = true; stop(); };
        groupController = modules[2].mountGroups({ user, onSelect: selectConversation, onGroupUpdated: updateGroup });
        peopleController = modules[5].mountPeople({ user, onSelect: chat => groupController.selectExternal(chat) });
        forumController = modules[3].mountForums({ user });
        forumController.setActive(activeSection === "forums");
        selectConversation(null, { reveal: false });
    } catch (error) {
        if (version === viewVersion) {
            connectionMessage(errorMessage(error), "error");
            renderMessagePlaceholder("Your chats couldn’t load", "Close and reopen chat to try again.");
        }
    }
}

openButton.addEventListener("click", async () => {
    openButton.disabled = true;
    openButton.setAttribute("aria-busy", "true");
    chatStatus.textContent = "Checking your saved sign-in...";
    try {
        const firebase = await loadAuth();
        const user = await firebase.restoreUser();
        chatStatus.textContent = "";
        if (user?.displayName?.trim()) {
            await showChat(user);
        } else {
            nameError.textContent = "";
            namePanel.showModal();
            nameInput.focus();
        }
    } catch (error) {
        chatStatus.textContent = errorMessage(error);
    } finally {
        openButton.disabled = false;
        openButton.removeAttribute("aria-busy");
    }
});

nameInput.addEventListener("input", () => nameInput.setCustomValidity(""));
nameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (joining) return;
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.setCustomValidity("Enter a display name first.");
        nameInput.reportValidity();
        return;
    }
    joining = true;
    joinButton.disabled = true;
    cancelButton.disabled = true;
    nameInput.disabled = true;
    nameError.textContent = "Saving your name...";
    try {
        const firebase = await loadAuth();
        const user = await firebase.joinChat(name);
        namePanel.close();
        nameForm.reset();
        nameError.textContent = "";
        await showChat(user);
    } catch (error) {
        nameError.textContent = errorMessage(error);
    } finally {
        joining = false;
        joinButton.disabled = false;
        cancelButton.disabled = false;
        nameInput.disabled = false;
    }
});

cancelButton.addEventListener("click", () => namePanel.close());
namePanel.addEventListener("cancel", (event) => {
    if (joining) event.preventDefault();
});
function closeChat() {
    if (!chatPanel.open || closing) return;
    setMenu(false);
    if (reducedMotion.matches) { chatPanel.close(); return; }
    closing = true;
    chatPanel.classList.add("is-closing");
    const finish = () => {
        clearTimeout(closeTimer);
        chatPanel.removeEventListener("animationend", onEnd);
        chatPanel.close();
    };
    const onEnd = event => { if (event.target === chatPanel) finish(); };
    chatPanel.addEventListener("animationend", onEnd);
    closeTimer = setTimeout(finish, 280);
}
closeButton.addEventListener("click", closeChat);
chatPanel.addEventListener("cancel", event => {
    if (event.target !== chatPanel) return;
    event.preventDefault(); closeChat();
});
chatPanel.addEventListener("close", () => {
    closing = false; clearTimeout(closeTimer); chatPanel.classList.remove("is-closing");
    drafts.set(currentGroup?.id || "Campus Chat", messageInput.value);
    setMenu(false); finishModeration();
    if (el("profile-panel")?.open) el("profile-panel").close();
    disconnectModerator();
    disconnectMessages(); groupController?.dispose(); groupController = null;
    peopleController?.dispose(); peopleController = null;
    forumController?.dispose(); forumController = null;
});

messageInput.addEventListener("input", () => {
    drafts.set(currentGroup?.id || "Campus Chat", messageInput.value);
    if (messageStatus.dataset.state === "error") { retryButton.hidden = true; statusMessage(""); }
});

messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser?.displayName || !chatPanel.open || !ready || sending || clearing || removing) return;
    const text = messageInput.value.trim();
    if (!text) return;
    const version = viewVersion;
    const groupId = currentGroup?.id;
    drafts.set(groupId || "Campus Chat", messageInput.value);
    sending = true;
    retryButton.hidden = true;
    updateControls();
    statusMessage(fromCache ? "Waiting for a connection… Your message is queued." : "Sending…", "loading");
    try {
        await chatService.sendMessage(currentUser, text, groupId);
        drafts.delete(groupId || "Campus Chat");
        if (version === viewVersion) {
            messageInput.value = "";
            statusMessage("Sent", "success");
        }
    } catch (error) {
        if (version === viewVersion) {
            statusMessage(`Message not sent. Your draft is kept. ${errorMessage(error)}`, "error");
            retryButton.hidden = false;
        }
    } finally {
        sending = false;
        updateControls();
        if (version === viewVersion) messageInput.focus({ preventScroll: true });
    }
});

clearButton.addEventListener("click", async () => {
    if (!currentUser || !isModerator || currentGroup || !ready || fromCache || sending || clearing || removing) return;
    const version = viewVersion;
    const reason = await askModeration({
        title: "Clear Campus Chat?",
        description: "This permanently removes all existing Campus Chat messages for everyone. Names and sign-ins are kept. Messages arriving after clearing starts are kept. Your reason is recorded.",
        action: "Clear chat for everyone"
    });
    if (reason === null || version !== viewVersion || !isModerator || !ready || fromCache || currentGroup || sending || clearing || removing) return;
    clearing = true;
    updateControls();
    statusMessage("Clearing shared chat history…", "loading");
    try {
        const count = await chatService.clearMessages(currentUser, reason, (done, total) => {
            if (version === viewVersion) statusMessage(`Clearing messages: ${done} of ${total}…`, "loading");
        });
        if (version === viewVersion) {
            discardOldLocalHistory();
            messageInput.value = "";
            statusMessage(`${count} message${count === 1 ? "" : "s"} cleared. Campus Chat is ready for a fresh conversation.`, "success");
        }
    } catch (error) {
        if (version === viewVersion) statusMessage(`Clear did not finish. ${errorMessage(error)}`, "error");
    } finally {
        clearing = false;
        updateControls();
        if (version === viewVersion) focusComposer();
    }
});
