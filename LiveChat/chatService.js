import { app } from "../firebase.js";
import {
    getFirestore, collection, addDoc, serverTimestamp,
    query, orderBy, limitToLast, onSnapshot,
    getDocsFromServer, getDocFromServer, writeBatch, doc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const db = getFirestore(app);
// Every user reads and writes the same conversation.
const campusMessages = collection(db, "chats", "Campus Chat", "messages");

export function watchMessages(onMessages, onError, groupId = null) {
    const reference = groupId ? collection(db, "chats", groupId, "messages") : campusMessages;
    const recentMessages = query(reference, orderBy("createdAt"), limitToLast(100));
    return onSnapshot(recentMessages, { includeMetadataChanges: true }, (snapshot) => {
        const messages = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data({ serverTimestamps: "estimate" }),
            pending: document.metadata.hasPendingWrites
        }));
        onMessages(messages, snapshot.metadata.fromCache);
    }, onError);
}

export async function sendMessage(user, text, groupId = null) {
    const message = text.trim();
    if (!user?.uid || !user.displayName?.trim()) throw new Error("Open chat and choose a name first.");
    if (!message || message.length > 2000) throw new Error("Messages must contain 1 to 2000 characters.");
    const data = {
        senderId: user.uid,
        name: user.displayName,
        text: message,
        createdAt: serverTimestamp()
    };
    if (!groupId) return addDoc(campusMessages, data);
    const messageRef = doc(collection(db, "chats", groupId, "messages"));
    // Server rules require a new message and activity reset in the same commit.
    const batch = writeBatch(db);
    batch.set(messageRef, data);
    batch.update(doc(db, "chats", groupId), { lastActivityAt: serverTimestamp(), lastMessageId: messageRef.id });
    await batch.commit();
    return messageRef;
}

export function watchModerator(uid, onRole, onError) {
    return onSnapshot(doc(db, "users", uid, "roles", "moderator"), { includeMetadataChanges: true }, snapshot => {
        onRole(!snapshot.metadata.fromCache && snapshot.data()?.enabled === true);
    }, error => { onRole(false); onError?.(error); });
}

async function requireModerator(user, reason) {
    if (!user?.uid) throw new Error("Sign in first.");
    const note = reason?.trim();
    if (!note || note.length > 300) throw new Error("Enter a moderation reason (1–300 characters).");
    const role = await getDocFromServer(doc(db, "users", user.uid, "roles", "moderator"));
    if (role.data()?.enabled !== true) throw new Error("Only a chat moderator can remove messages or clear Campus Chat.");
    return note;
}

function recordRemoval(batch, reference, user, reason, action) {
    const audit = doc(db, "chats", reference.parent.parent.id, "moderation", reference.id);
    batch.set(audit, { action, messageId: reference.id, actorId: user.uid, createdAt: serverTimestamp(), reason });
    batch.delete(reference);
}

export async function removeMessage(user, messageId, reason, groupId = null) {
    const note = await requireModerator(user, reason);
    const batch = writeBatch(db);
    recordRemoval(batch, doc(db, "chats", groupId || "Campus Chat", "messages", messageId), user, note, "remove");
    await batch.commit();
}

export async function clearMessages(user, reason, onProgress = () => {}) {
    const note = await requireModerator(user, reason);
    // Read ALL saved messages, not only the 100 currently visible.
    // Capture their IDs once so messages arriving afterward aren't deleted.
    const snapshot = await getDocsFromServer(campusMessages);
    let deleted = 0;
    // Four removals per commit stay within the rules' document-access budget.
    // Every deletion has an audit record; revocation blocks subsequent batches.
    for (let offset = 0; offset < snapshot.docs.length; offset += 4) {
        const documents = snapshot.docs.slice(offset, offset + 4);
        const batch = writeBatch(db);
        documents.forEach((document) => recordRemoval(batch, document.ref, user, note, "clear"));
        try {
            await batch.commit();
        } catch (error) {
            throw new Error(`Cleared ${deleted} of ${snapshot.size} messages. Some remain; click Clear to retry. ${error.message}`);
        }
        deleted += documents.length;
        onProgress(deleted, snapshot.size);
    }
    return deleted;
}
