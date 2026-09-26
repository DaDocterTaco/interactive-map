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
let expiryTimer;
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

function disconnectModerator() {
    stopModerator?.();
    stopModerator = null;
    isModerator = false;
    document.getElementById("moderation-status").textContent = "";
    updateControls();
}

function selectSection(section) {
    activeSection = section;
    const forums = section === "forums";
    document.getElementById("chats-tab").setAttribute("aria-pressed", String(!forums));
    document.getElementById("forums-tab").setAttribute("aria-pressed", String(forums));
    document.getElementById("chats-sidebar").hidden = forums;
    document.getElementById("chats-conversation").hidden = forums;
    document.getElementById("forums-panel").hidden = !forums;
    document.getElementById("forums-sidebar").hidden = !forums;
    forumController?.setActive(forums);
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
            return "Enable Anonymous in Firebase Console > Authentication > Sign-in method, then try again.";
        case "auth/configuration-not-found":
            return "Set up Firebase Authentication and enable Anonymous sign-in.";
        case "auth/network-request-failed":
        case "unavailable":
            return "Could not reach Firebase. Check your internet connection and reopen chat to retry.";
        case "permission-denied":
            return "Firestore denied access. The group may have closed, or the chat rules need publishing. Reopen chat to retry.";
        case "not-found":
            return "Create the default Cloud Firestore database in your Firebase project, then reopen chat.";
        case "auth/unauthorized-domain":
            return "Add this website's hostname under Firebase Authentication > Settings > Authorized domains.";
        case "auth/web-storage-unsupported":
            return "Allow this website to store browser data so it can remember your sign-in.";
        case "auth/too-many-requests":
            return "Firebase is temporarily limiting sign-ins. Please try again later.";
        default:
            return error.message || "Could not connect. Please try again.";
    }
}

function updateControls() {
    sendButton.disabled = !ready || sending || clearing || removing;
    clearButton.hidden = !isModerator || !!currentGroup;
    clearButton.disabled = !isModerator || !ready || fromCache || sending || clearing || removing;
    messageInput.disabled = !ready || sending || clearing || removing;
    removalButtons.forEach(button => { button.disabled = !isModerator || !ready || fromCache || sending || clearing || removing; });
}

function disconnectMessages() {
    viewVersion++;
    if (stopMessages) stopMessages();
    stopMessages = null;
    if (stopRequests) stopRequests();
    stopRequests = null;
    clearTimeout(expiryTimer);
    document.getElementById("access-requests").replaceChildren();
    ready = false;
    latestMessages = [];
    removalButtons = [];
    updateControls();
}

function discardOldLocalHistory() {
    // The old local demo must never reappear or be uploaded as shared history.
    try {
        localStorage.removeItem(`fiu-chat:campus-public:${currentUser.uid}:messages`);
    } catch { /* Firestore works even if old local storage cannot be removed. */ }
}

function renderMessages(messages) {
    latestMessages = messages;
    removalButtons = [];
    const nearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
    const previousScroll = messageList.scrollTop;
    const wasEmpty = messageList.children.length === 0;
    messageList.replaceChildren();
    for (const message of messages) {
        const item = document.createElement("li");
        const date = message.createdAt?.toDate?.();
        const time = date ? date.toLocaleString() : "Time pending";
        item.textContent = `${message.name}: ${message.text} — ${time}${message.pending ? " (sending...)" : ""}`;
        item.title = `User ID: ${message.senderId}`;
        if (isModerator && currentGroup?.visibility !== "direct" && !message.pending) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "remove-message";
            button.textContent = "Remove";
            button.setAttribute("aria-label", `Remove message by ${message.name}`);
            const version = viewVersion;
            button.addEventListener("click", async () => {
                if (version !== viewVersion || !isModerator || !ready || fromCache || sending || clearing || removing) return;
                const reason = window.prompt("Why are you removing this message? (1–300 characters)");
                if (reason === null) return;
                if (!window.confirm("Remove this message for everyone? This cannot be undone.")) return;
                removing = true;
                updateControls();
                try {
                    await chatService.removeMessage(currentUser, message.id, reason, currentGroup?.id);
                    if (version === viewVersion) messageStatus.textContent = "Message removed. The moderation action was recorded.";
                } catch (error) {
                    if (version === viewVersion) messageStatus.textContent = `Message not removed. ${errorMessage(error)}`;
                } finally {
                    removing = false;
                    updateControls();
                }
            });
            removalButtons.push(button);
            item.appendChild(button);
        }
        messageList.appendChild(item);
    }
    messageList.scrollTop = nearBottom || wasEmpty ? messageList.scrollHeight : previousScroll;
    updateControls();
}

function updateGroup(group) {
    if (group.visibility === "direct") return;
    if (currentGroup?.id !== group.id) return;
    currentGroup = group;
    const closed = groupService.isClosed(group);
    document.getElementById("group-settings").hidden = closed || group.creatorId !== currentUser.uid;
    document.getElementById("group-expiry").textContent = closed
        ? "Closed after inactivity. Create a new group to keep chatting."
        : `Closes after ${group.idleHours} hours without messages · ${new Date(groupService.expiresAt(group)).toLocaleString()}`;
    clearTimeout(expiryTimer);
    if (closed) {
        peopleController?.setConversation(null);
        disconnectMessages();
        messageList.replaceChildren();
        connectionStatus.textContent = "This group is closed.";
    } else {
        expiryTimer = setTimeout(() => updateGroup(currentGroup), Math.max(1, groupService.expiresAt(group) - Date.now()));
    }
}

function renderRequests(requests, group, version) {
    const container = document.getElementById("access-requests");
    container.replaceChildren();
    for (const request of requests) {
        const card = document.createElement("div");
        card.className = "access-request";
        const text = document.createElement("p");
        text.textContent = `${request.name} requests access. Allow this user to join?`;
        card.appendChild(text);
        const buttons = [];
        for (const accept of [true, false]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = accept ? "Accept" : "Deny";
            buttons.push(button);
            button.addEventListener("click", async () => {
                buttons.forEach(item => { item.disabled = true; });
                try { await groupService.decideRequest(group.id, request.id, currentUser, accept); }
                catch (error) {
                    if (version === viewVersion) { text.textContent = `${request.name}: ${errorMessage(error)}`; buttons.forEach(item => { item.disabled = false; }); }
                }
            });
            card.appendChild(button);
        }
        container.appendChild(card);
    }
}

function selectConversation(group) {
    drafts.set(currentGroup?.id || "Campus Chat", messageInput.value);
    disconnectMessages();
    const version = viewVersion;
    currentGroup = group;
    peopleController?.setConversation(group);
    messageInput.value = drafts.get(group?.id || "Campus Chat") || "";
    messageList.replaceChildren();
    messageStatus.textContent = "";
    document.getElementById("chat-title").textContent = group ? group.name : "Campus Chat";
    document.getElementById("group-settings").hidden = true;
    document.getElementById("group-expiry").textContent = "";
    document.getElementById("chat-help").textContent = group?.visibility === "direct"
        ? "Private conversation. Only you and this person can read these messages."
        : group
        ? "Showing the latest 100 messages. Every message restarts the inactivity timer."
        : "Showing the latest 100 messages. Only moderators can clear Campus Chat.";
    updateControls();
    connectionStatus.textContent = "Connecting to shared chat...";
    if (group && group.visibility !== "direct") {
        updateGroup(group);
        if (groupService.isClosed(group)) return;
    }
    stopMessages = chatService.watchMessages((messages, cached) => {
        if (version !== viewVersion) return;
        ready = true;
        fromCache = cached;
        renderMessages(messages);
        connectionStatus.textContent = cached
            ? "Waiting for Firebase. Messages may be cached; sends will wait for a connection."
            : group?.visibility === "direct" ? "Connected. Private messages between you and this person."
            : group ? "Connected. Messages are shared with this group's members." : "Connected. Messages are shared with everyone in Campus Chat.";
        updateControls();
    }, error => {
        if (version !== viewVersion) return;
        ready = false;
        connectionStatus.textContent = errorMessage(error);
        updateControls();
    }, group?.id);
    if (group?.visibility === "private") stopRequests = groupService.watchRequests(group.id, requests => {
        if (version === viewVersion) renderRequests(requests, group, version);
    }, error => {
        if (version === viewVersion) document.getElementById("access-requests").textContent = `Access requests unavailable: ${errorMessage(error)}`;
    });
    if (activeSection === "chats") messageInput.focus();
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
    document.getElementById("chat-identity").textContent = `Chatting as ${user.displayName}`;
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
            document.getElementById("moderation-status").textContent = enabled ? "Chat moderator · Removals require a reason and are recorded." : "";
            renderMessages(latestMessages);
        }, () => {
            if (!disposed && chatPanel.open) document.getElementById("moderation-status").textContent = "Moderator access could not be checked. Reopen chat to retry.";
        });
        stopModerator = () => { disposed = true; stop(); };
        groupController = modules[2].mountGroups({ user, onSelect: selectConversation, onGroupUpdated: updateGroup });
        peopleController = modules[5].mountPeople({ user, onSelect: chat => groupController.selectExternal(chat) });
        forumController = modules[3].mountForums({ user });
        forumController.setActive(activeSection === "forums");
        selectConversation(null);
    } catch (error) {
        if (version === viewVersion) connectionStatus.textContent = errorMessage(error);
    }
}

openButton.addEventListener("click", async () => {
    openButton.disabled = true;
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
closeButton.addEventListener("click", () => chatPanel.close());
chatPanel.addEventListener("close", () => {
    disconnectModerator();
    disconnectMessages(); groupController?.dispose(); groupController = null;
    peopleController?.dispose(); peopleController = null;
    forumController?.dispose(); forumController = null;
});

messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser?.displayName || !chatPanel.open || !ready || sending || clearing || removing) return;
    const text = messageInput.value.trim();
    if (!text) return;
    const version = viewVersion;
    const groupId = currentGroup?.id;
    sending = true;
    updateControls();
    messageStatus.textContent = "Saving to Firebase...";
    try {
        await chatService.sendMessage(currentUser, text, groupId);
        drafts.delete(groupId || "Campus Chat");
        if (version === viewVersion) {
            messageInput.value = "";
            messageStatus.textContent = "Saved to Firebase.";
        }
    } catch (error) {
        if (version === viewVersion) messageStatus.textContent = `Message not saved. ${errorMessage(error)}`;
    } finally {
        sending = false;
        updateControls();
        if (version === viewVersion) messageInput.focus();
    }
});

clearButton.addEventListener("click", async () => {
    if (!currentUser || !isModerator || currentGroup || !ready || fromCache || sending || clearing || removing) return;
    const reason = window.prompt("Why are you clearing Campus Chat? (1–300 characters)");
    if (reason === null) return;
    if (!window.confirm("Delete ALL existing Campus Chat messages from Firebase for EVERYONE? This cannot be undone. Names and sign-ins are kept. Messages arriving after clearing starts are kept.")) return;
    const version = viewVersion;
    clearing = true;
    updateControls();
    messageStatus.textContent = "Deleting shared chat history...";
    try {
        const count = await chatService.clearMessages(currentUser, reason, (done, total) => {
            if (version === viewVersion) messageStatus.textContent = `Deleting messages: ${done} of ${total}...`;
        });
        if (version === viewVersion) {
            discardOldLocalHistory();
            messageInput.value = "";
            messageStatus.textContent = `Deleted ${count} messages from Firebase. Campus Chat is ready for new messages.`;
        }
    } catch (error) {
        if (version === viewVersion) messageStatus.textContent = `Clear did not finish. ${errorMessage(error)}`;
    } finally {
        clearing = false;
        updateControls();
        if (version === viewVersion) messageInput.focus();
    }
});
