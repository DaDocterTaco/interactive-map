import { app } from "../firebase.js";
import { makeSalt, passwordVerifier } from "./groupPassword.js";
import {
    getFirestore, collection, doc, getDoc, setDoc, deleteDoc,
    serverTimestamp, onSnapshot, query, where, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Group documents are discoverable; membership, access requests, and password
// verifiers live in protected child documents checked by Firestore rules.
const db = getFirestore(app);
const groupCollection = collection(db, "chats");
const groupRef = id => doc(groupCollection, id);
const memberRef = (id, uid) => doc(db, "chats", id, "members", uid);
const requestRef = (id, uid) => doc(db, "chats", id, "requests", uid);

// Old records may still contain idleHours. They remain open regardless of age;
// only an explicit owner deletion closes a group.
export function isClosed(group) { return Boolean(group?.deletedAt); }

export function watchGroups(callback, onError) {
    return onSnapshot(query(groupCollection, where("visibility", "in", ["public", "private"])), { includeMetadataChanges: true }, snapshot => callback(snapshot.docs.filter(item => item.id !== "Campus Chat").map(item => {
        const data = item.data({ serverTimestamps: "estimate" });
        // Keep the confirmation dialog in its deleting state until the server
        // accepts the tombstone. A rejected optimistic write must remain retryable.
        if (item.metadata.hasPendingWrites && data.deletedAt && !item.data({ serverTimestamps: "none" }).deletedAt) {
            delete data.deletedAt;
            delete data.deletedBy;
        }
        return { id: item.id, ...data };
    })), onError);
}
export function watchPins(uid, callback, onError) {
    return onSnapshot(collection(db, "chatPreferences", uid, "pins"),
        snapshot => callback(new Set(snapshot.docs.map(item => item.id))), onError);
}
export async function setPinned(uid, id, pinned) {
    const reference = doc(db, "chatPreferences", uid, "pins", id);
    if (pinned) await setDoc(reference, { pinnedAt: serverTimestamp() });
    else await deleteDoc(reference);
}

export async function createGroup(user, { name, visibility, password }) {
    const title = name.trim();
    if (title === "Campus Chat" || title.startsWith("dm:")) throw new Error("Campus Chat is reserved. Choose another name.");
    if (/[\/\x00-\x1f\x7f]/.test(title) || [".", ".."].includes(title) || /^__.*__$/.test(title)) throw new Error("Chat names cannot contain slashes, control characters, or reserved document names.");
    if (!title || title.length > 60) throw new Error("Enter a group name up to 60 characters.");
    if (!["public", "private"].includes(visibility)) throw new Error("Choose public or private.");
    const salt = visibility === "private" ? makeSalt() : "";
    const proof = visibility === "private" ? await passwordVerifier(password, salt) : "";
    const reference = doc(groupCollection, title);
    if ((await getDoc(reference)).exists()) throw new Error("That chat name is already taken. Choose another name.");
    // Create the group, creator membership, and private verifier atomically so
    // no discoverable group exists without its required access records.
    const batch = writeBatch(db);
    batch.set(reference, {
        name: title, visibility, salt,
        creatorId: user.uid, createdAt: serverTimestamp(), lastActivityAt: serverTimestamp(), lastMessageId: ""
    });
    if (visibility === "private") batch.set(doc(db, "chats", reference.id, "private", "password"), { verifier: proof });
    batch.set(doc(db, "chats", reference.id, "people", user.uid), { uid: user.uid });
    batch.set(memberRef(reference.id, user.uid), { joinedAt: serverTimestamp(), proof });
    try { await batch.commit(); }
    catch (error) {
        if (error.code === "permission-denied" && (await getDoc(reference)).exists()) throw new Error("That chat name is already taken. Choose another name.");
        throw error;
    }
    const saved = await getDoc(reference);
    return { id: saved.id, ...saved.data() };
}

export async function isMember(id, uid) { return (await getDoc(memberRef(id, uid))).exists(); }
export async function joinGroup(group, user, password = "") {
    if (isClosed(group)) throw new Error("This group was deleted by its creator.");
    if (await isMember(group.id, user.uid)) {
        const person = doc(db, "chats", group.id, "people", user.uid);
        await runTransaction(db, async transaction => { if (!(await transaction.get(person)).exists()) transaction.set(person, { uid: user.uid }); });
        return;
    }
    const proof = group.visibility === "private" ? await passwordVerifier(password, group.salt) : "";
    const batch = writeBatch(db);
    batch.set(memberRef(group.id, user.uid), { joinedAt: serverTimestamp(), proof });
    batch.set(doc(db, "chats", group.id, "people", user.uid), { uid: user.uid });
    await batch.commit();
    // A password join also dismisses a pending request from this same person.
    const request = await getDoc(requestRef(group.id, user.uid));
    if (request.exists() && request.data().status === "pending") await deleteDoc(request.ref);
}

export async function requestAccess(group, user) {
    if (isClosed(group)) throw new Error("This group was deleted by its creator.");
    const reference = requestRef(group.id, user.uid);
    await runTransaction(db, async transaction => {
        const existing = await transaction.get(reference);
        if (existing.exists() && existing.data().status === "pending") return;
        if (existing.exists() && existing.data().status === "accepted") throw new Error("You already have access. Reopen this group.");
        transaction.set(reference, {
            userId: user.uid, name: user.displayName, status: "pending",
            createdAt: serverTimestamp(), decidedAt: null, decidedBy: ""
        });
    });
}
export function watchMyRequest(id, uid, callback, onError) {
    return onSnapshot(requestRef(id, uid), snapshot => callback(snapshot.exists() ? snapshot.data() : null), onError);
}
export function watchMembership(id, uid, callback, onError) {
    return onSnapshot(memberRef(id, uid), { includeMetadataChanges: true }, snapshot => {
        // A guessed password creates a local optimistic document before rules run.
        // Only a server-confirmed membership is allowed to open the private chat.
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) callback(snapshot.exists());
    }, onError);
}
export function watchRequests(id, callback, onError) {
    return onSnapshot(query(collection(db, "chats", id, "requests"), where("status", "==", "pending")),
        snapshot => callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError);
}
export async function decideRequest(groupId, requesterId, member, accept) {
    // Acceptance and membership must commit together for both rules and UI.
    await runTransaction(db, async transaction => {
        const reference = requestRef(groupId, requesterId);
        const request = await transaction.get(reference);
        if (!request.exists() || request.data().status !== "pending") throw new Error("This request has already been handled.");
        transaction.update(reference, {
            status: accept ? "accepted" : "denied", decidedAt: serverTimestamp(), decidedBy: member.uid
        });
        if (accept) {
            transaction.set(memberRef(groupId, requesterId), { joinedAt: serverTimestamp(), proof: "" });
            transaction.set(doc(db, "chats", groupId, "people", requesterId), { uid: requesterId });
        }
    });
}
export async function deleteGroup(id, user) {
    if (!user?.uid) throw new Error("Sign in before deleting a group.");
    if (id === "Campus Chat" || id.startsWith("dm:")) throw new Error("Only group chats can be deleted.");
    await runTransaction(db, async transaction => {
        const reference = groupRef(id);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("This group no longer exists.");
        const group = snapshot.data();
        if (!["public", "private"].includes(group.visibility)) throw new Error("Only group chats can be deleted.");
        if (group.creatorId !== user.uid) throw new Error("Only the group creator can delete this group.");
        if (isClosed(group)) throw new Error("This group was already deleted.");
        // Keep the parent document permanently. Reusing its name could otherwise
        // expose retained child messages, memberships, and password records.
        transaction.update(reference, { deletedAt: serverTimestamp(), deletedBy: user.uid });
    });
}
