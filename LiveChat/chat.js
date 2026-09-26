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
let currentUser = null;
let stopMessages;
let viewVersion = 0;
let joining = false;
let sending = false;
let clearing = false;
let ready = false;
let fromCache = true;

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
            return "Firestore denied access. Publish the Campus Chat rules for this Firebase project, then reopen chat.";
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
    sendButton.disabled = !ready || sending || clearing;
    clearButton.disabled = !ready || fromCache || sending || clearing;
    messageInput.disabled = sending || clearing;
}

function disconnectMessages() {
    viewVersion++;
    if (stopMessages) stopMessages();
    stopMessages = null;
    ready = false;
    updateControls();
}

function discardOldLocalHistory() {
    // The old local demo must never reappear or be uploaded as shared history.
    try {
        localStorage.removeItem(`fiu-chat:campus-public:${currentUser.uid}:messages`);
    } catch { /* Firestore works even if old local storage cannot be removed. */ }
}

function renderMessages(messages) {
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
        messageList.appendChild(item);
    }
    messageList.scrollTop = nearBottom || wasEmpty ? messageList.scrollHeight : previousScroll;
}

async function showChat(user) {
    disconnectMessages();
    const version = viewVersion;
    currentUser = user;
    messageList.replaceChildren();
    messageStatus.textContent = "";
    connectionStatus.textContent = "Connecting to shared Campus Chat...";
    document.getElementById("chat-identity").textContent = `Chatting as ${user.displayName}`;
    discardOldLocalHistory();
    if (!chatPanel.open) chatPanel.showModal();
    try {
        chatService = await import("./chatService.js");
        if (version !== viewVersion || !chatPanel.open) return;
        stopMessages = chatService.watchMessages((messages, cached) => {
            if (version !== viewVersion) return;
            ready = true;
            fromCache = cached;
            renderMessages(messages);
            connectionStatus.textContent = cached
                ? "Waiting for Firebase. Messages may be cached; sends will wait for a connection."
                : "Connected. Messages are shared with everyone in Campus Chat.";
            updateControls();
        }, (error) => {
            if (version !== viewVersion) return;
            ready = false;
            connectionStatus.textContent = errorMessage(error);
            updateControls();
        });
        messageInput.focus();
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
chatPanel.addEventListener("close", disconnectMessages);

messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser?.displayName || !chatPanel.open || !ready || sending || clearing) return;
    const text = messageInput.value.trim();
    if (!text) return;
    const version = viewVersion;
    sending = true;
    updateControls();
    messageStatus.textContent = "Saving to Firebase...";
    try {
        await chatService.sendMessage(currentUser, text);
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
    if (!currentUser || !ready || fromCache || sending || clearing) return;
    if (!window.confirm("Delete ALL existing Campus Chat messages from Firebase for EVERYONE? This cannot be undone. Names and sign-ins are kept. Messages arriving after clearing starts are kept.")) return;
    const version = viewVersion;
    clearing = true;
    updateControls();
    messageStatus.textContent = "Deleting shared chat history...";
    try {
        const count = await chatService.clearMessages((done, total) => {
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
