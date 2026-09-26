import { app } from "../../firebase.js";
import {
    getFirestore, collection, doc, onSnapshot, query, orderBy, limit, limitToLast,
    serverTimestamp, setDoc, writeBatch, increment, runTransaction, getDocFromServer
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const db = getFirestore(app);
export const categories = ["Question", "Comment", "Concern", "Alert", "Other"];
const posts = collection(db, "forums");
const record = snapshot => ({ id: snapshot.id, ...snapshot.data({ serverTimestamps: "estimate" }), pending: snapshot.metadata.hasPendingWrites });

function identity(user) {
    if (!user?.uid || !user.displayName?.trim() || user.displayName.length > 40) {
        throw new Error("Open chat and choose a name first.");
    }
    return { authorId: user.uid, name: user.displayName.trim() };
}

function text(value, maximum, label) {
    const clean = typeof value === "string" ? value.trim() : "";
    if (!clean || clean.length > maximum) throw new Error(`${label} must contain 1–${maximum} characters.`);
    return clean;
}

export function watchPosts(count, onPosts, onError) {
    return onSnapshot(query(posts, orderBy("createdAt", "desc"), limit(count)), { includeMetadataChanges: true },
        snapshot => onPosts(snapshot.docs.map(record), snapshot.metadata.fromCache), onError);
}

export function watchPost(id, onPost, onError) {
    return onSnapshot(doc(posts, id), { includeMetadataChanges: true },
        snapshot => onPost(snapshot.exists() ? record(snapshot) : null), onError);
}

export function watchReplies(id, count, onReplies, onError) {
    return onSnapshot(query(collection(posts, id, "replies"), orderBy("createdAt"), limitToLast(count)),
        { includeMetadataChanges: true }, snapshot => onReplies(snapshot.docs.map(record), snapshot.metadata.fromCache), onError);
}

export async function createPost(user, title, body, category, location = null) {
    if (!categories.includes(category)) throw new Error("Choose a discussion type.");
    const reference = doc(posts);
    const alert = category === "Alert" ? { location: validateLocation(location), confirmationCount: 0, lastConfirmationBy: "" } : {};
    await setDoc(reference, {
        ...identity(user), title: text(title, 140, "Title"), body: text(body, 5000, "Post"), category,
        createdAt: serverTimestamp(), lastActivityAt: serverTimestamp(), replyCount: 0, lastReplyId: "", ...alert
    });
    return reference.id;
}

export function validateLocation(location) {
    if (!location || typeof location.latitude !== "number" || !Number.isFinite(location.latitude)
        || Math.abs(location.latitude) > 90 || typeof location.longitude !== "number"
        || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
        throw new Error("Choose a location on the picker or enter valid latitude and longitude.");
    }
    return { label: text(location.label, 120, "Location name"), latitude: location.latitude, longitude: location.longitude };
}

export function watchConfirmation(postId, uid, callback, onError) {
    return onSnapshot(doc(posts, postId, "confirmations", uid), { includeMetadataChanges: true }, snapshot => {
        callback(snapshot.exists(), snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites);
    }, onError);
}

export function watchVerifier(uid, callback, onError) {
    return onSnapshot(doc(db, "users", uid, "roles", "verifier"), { includeMetadataChanges: true }, snapshot => {
        callback(!snapshot.metadata.fromCache && snapshot.data()?.enabled === true);
    }, onError);
}

export async function approveReport(user, postId) {
    const author = identity(user);
    const parent = doc(posts, postId);
    let attemptedWrite = false;
    try { await runTransaction(db, async transaction => {
        const role = await transaction.get(doc(db, "users", user.uid, "roles", "verifier"));
        if (role.data()?.enabled !== true) throw new Error("Only an authorized verifier can approve reports.");
        const report = await transaction.get(parent);
        if (!report.exists() || report.data().category !== "Alert") throw new Error("This alert is unavailable.");
        if (report.data().authorId === user.uid) throw new Error("Another verifier must review your own report.");
        if (report.data().verification?.status === "approved") return;
        attemptedWrite = true;
        transaction.update(parent, { verification: {
            status: "approved", verifierId: user.uid, verifierName: author.name, approvedAt: serverTimestamp()
        } });
    }); } catch (error) {
        // A concurrent verifier may have approved the immutable record first.
        if (attemptedWrite && error.code === "permission-denied"
            && (await getDocFromServer(parent)).data()?.verification?.status === "approved") return;
        throw error;
    }
}

export async function setConfirmation(user, postId, confirmed) {
    const author = identity(user);
    const parent = doc(posts, postId), confirmation = doc(parent, "confirmations", user.uid);
    let attemptedWrite = false;
    try { await runTransaction(db, async transaction => {
        const report = await transaction.get(parent);
        const existing = await transaction.get(confirmation);
        if (!report.exists() || report.data().category !== "Alert") throw new Error("This alert is unavailable.");
        if (report.data().authorId === user.uid) throw new Error("You cannot confirm your own report.");
        if (existing.exists() === confirmed) return;
        attemptedWrite = true;
        if (confirmed) transaction.set(confirmation, { userId: user.uid, name: author.name, createdAt: serverTimestamp() });
        else transaction.delete(confirmation);
        transaction.update(parent, { confirmationCount: increment(confirmed ? 1 : -1), lastConfirmationBy: user.uid });
    }); } catch (error) {
        // Rules can reject a stale transaction before its conflict retry when
        // another tab has already applied this account's requested change.
        if (attemptedWrite && error.code === "permission-denied"
            && (await getDocFromServer(confirmation)).exists() === confirmed) return;
        throw error;
    }
}

export async function sendReply(user, postId, body) {
    const parent = doc(posts, postId);
    const reply = doc(collection(parent, "replies"));
    const batch = writeBatch(db);
    batch.set(reply, { ...identity(user), body: text(body, 2000, "Reply"), createdAt: serverTimestamp() });
    // Save the reply and count together, including when two people reply at once.
    batch.update(parent, { replyCount: increment(1), lastReplyId: reply.id, lastActivityAt: serverTimestamp() });
    await batch.commit();
    return reply.id;
}
