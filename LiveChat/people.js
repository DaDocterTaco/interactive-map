import { app } from "../firebase.js";
import { getFirestore, doc, collection, getDoc, getDocs, query, where, orderBy, startAt, endAt, limit, onSnapshot, serverTimestamp, runTransaction, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const db = getFirestore(app);
export const directId = (a, b) => "dm:" + [a, b].sort().join(":");
export async function saveProfile(user) {
    const displayName = user.displayName?.trim();
    if (!displayName) throw Error("Choose a display name first.");
    const reference = doc(db, "users", user.uid);
    await runTransaction(db, async transaction => {
        const saved = await transaction.get(reference);
        if (saved.exists() && saved.data().displayName === displayName) return;
        transaction.set(reference, { uid: user.uid, displayName, searchName: displayName.toLowerCase(),
            createdAt: saved.exists() ? saved.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    });
}
export async function getProfile(uid) {
    const result = await getDoc(doc(db, "users", uid));
    return result.exists() ? { id: uid, ...result.data() } : { id: uid, uid, displayName: "User " + uid.slice(-6) };
}
export async function searchPeople(text, self) {
    const term = text.trim().toLowerCase();
    if (!term) return [];
    const result = await getDocs(query(collection(db, "users"), orderBy("searchName"), startAt(term), endAt(term + "\uf8ff"), limit(25)));
    return result.docs.filter(item => item.id !== self).map(item => ({ id: item.id, ...item.data() }));
}
export function watchFriends(uid, callback, onError) {
    return onSnapshot(collection(db, "users", uid, "friends"), snapshot => callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError);
}
export async function saveFriend(user, other) {
    if (user.uid === other.uid) throw Error("You cannot add yourself.");
    const reference = doc(db, "users", user.uid, "friends", other.uid);
    await runTransaction(db, async transaction => {
        if ((await transaction.get(reference)).exists()) return;
        transaction.set(reference, { friendId: other.uid, chatId: directId(user.uid, other.uid), savedAt: serverTimestamp() });
    });
}
export function removeFriend(user, other) { return deleteDoc(doc(db, "users", user.uid, "friends", other.uid)); }
export async function openDirect(user, other) {
    if (user.uid === other.uid) throw Error("Choose another person to message.");
    const ids = [user.uid, other.uid].sort();
    const reference = doc(db, "chats", directId(...ids));
    await runTransaction(db, async transaction => {
        const current = await transaction.get(reference);
        if (current.exists()) return;
        transaction.set(reference, { visibility: "direct", name: "Direct message", participantIds: ids,
            createdAt: serverTimestamp(), lastActivityAt: serverTimestamp(), lastMessageId: "" });
    });
    const saved = await getDoc(reference);
    return { id: saved.id, ...saved.data(), name: other.displayName, otherId: other.uid };
}
export function watchDirects(uid, callback, onError) {
    return onSnapshot(query(collection(db, "chats"), where("participantIds", "array-contains", uid)),
        snapshot => callback(snapshot.docs.map(item => ({ id: item.id, ...item.data({ serverTimestamps: "estimate" }) }))), onError);
}
export function watchMembers(groupId, callback, onError) {
    return onSnapshot(collection(db, "chats", groupId, "people"),
        snapshot => callback(snapshot.docs.map(item => item.id)), onError);
}
