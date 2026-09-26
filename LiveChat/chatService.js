import { app } from "../firebase.js";
import {
    getFirestore, collection, addDoc, serverTimestamp,
    query, orderBy, limitToLast, onSnapshot,
    getDocsFromServer, writeBatch, doc
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

export async function clearMessages(onProgress = () => {}) {
    // Read ALL saved messages, not only the 100 currently visible.
    // Capture their IDs once so messages arriving afterward aren't deleted.
    const snapshot = await getDocsFromServer(campusMessages);
    let deleted = 0;
    for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
        const documents = snapshot.docs.slice(offset, offset + 450);
        const batch = writeBatch(db);
        documents.forEach((document) => batch.delete(document.ref));
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
