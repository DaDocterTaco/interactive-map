import { app } from "../../firebase.js";
import {
    getFirestore, collection, doc, onSnapshot, query, orderBy, limit, limitToLast,
    serverTimestamp, setDoc, writeBatch, increment, runTransaction, getDocFromServer
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Firestore API for discussions and location-based alert reports. Rules enforce
// the same author, verifier, counter, and lifecycle constraints on the server.
const db = getFirestore(app);
export const categories = ["Question", "Comment", "Concern", "Alert", "Other"];
const forumTopics = ["Classes", "Study spaces", "Campus life", "Parking & transit", "Housing", "Other"];
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

// One listener supplies archive-wide search, topic filters, and answer previews.
// Render the results in pages in the UI; do not attach a reply listener per card.
export function watchAllPosts(onPosts, onError) {
    return onSnapshot(query(posts, orderBy("createdAt", "desc")), { includeMetadataChanges: true },
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

export function watchAllReplies(id, onReplies, onError) {
    return onSnapshot(query(collection(posts, id, "replies"), orderBy("createdAt")),
        { includeMetadataChanges: true }, snapshot => onReplies(snapshot.docs.map(record), snapshot.metadata.fromCache), onError);
}

export function watchSavedPosts(uid, onSaved, onError) {
    return onSnapshot(collection(db, "users", uid, "savedForums"), { includeMetadataChanges: true },
        snapshot => onSaved(snapshot.docs.map(item => item.id), snapshot.metadata.fromCache), onError);
}

export async function setSavedPost(user, postId, saved) {
    identity(user);
    const reference = doc(db, "users", user.uid, "savedForums", postId);
    const batch = writeBatch(db);
    if (saved) batch.set(reference, { postId, savedAt: serverTimestamp() });
    else batch.delete(reference);
    await batch.commit();
}

export function newPostId() { return doc(posts).id; }
export async function createPost(user, title, body, category, location = null, topic = "", options = {}) {
    if (!categories.includes(category)) throw new Error("Choose a discussion type.");
    if (topic && !forumTopics.includes(topic)) throw new Error("Choose a valid topic.");
    if (options.submissionId && !/^[A-Za-z0-9_-]{1,128}$/.test(options.submissionId)) throw Error("Invalid submission ID.");
    const reference = options.submissionId ? doc(posts, options.submissionId) : doc(posts);
    const alert = category === "Alert" ? { location: validateLocation(location), confirmationCount: 0, lastConfirmationBy: "" } : {};
    const payload = {
        ...identity(user), title: text(title, 140, "Title"), body: text(body, 5000, "Post"), category,
        createdAt: serverTimestamp(), lastActivityAt: serverTimestamp(), replyCount: 0, lastReplyId: "", ...alert,
        ...(category !== "Alert" && topic ? { topic } : {}),
        ...(category === "Alert" && options.issueType ? { issueType: text(options.issueType, 40, "Problem type") } : {})
    };
    if (options.submissionId) {
        // A retry uses the same document. Never silently overwrite a prior send.
        await runTransaction(db, async transaction => {
            const previous = await transaction.get(reference);
            if (previous.exists()) {
                const data = previous.data();
                if (data.authorId !== user.uid || data.title !== payload.title || data.body !== payload.body || data.category !== category
                    || (data.topic || '') !== (payload.topic || '') || (data.issueType || '') !== (payload.issueType || '')
                    || ['label', 'latitude', 'longitude'].some(key => data.location?.[key] !== payload.location?.[key])) throw Error("This draft was already submitted. Open My reports before sending changes.");
                return;
            }
            transaction.set(reference, payload);
        });
    } else await setDoc(reference, payload);
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
    // Treat cached role data as untrusted until the server confirms it.
    return onSnapshot(doc(db, "users", uid, "roles", "verifier"), { includeMetadataChanges: true }, snapshot => {
        callback(!snapshot.metadata.fromCache && snapshot.data()?.enabled === true);
    }, onError);
}

export async function approveReport(user, postId) {
    // The role and report are read in one transaction so revocation or another
    // verifier's approval cannot silently overwrite an immutable approval.
    const author = identity(user);
    const parent = doc(posts, postId);
    let attemptedWrite = false;
    try { await runTransaction(db, async transaction => {
        const role = await transaction.get(doc(db, "users", user.uid, "roles", "verifier"));
        if (role.data()?.enabled !== true) throw new Error("Only an authorized verifier can approve reports.");
        const report = await transaction.get(parent);
        if (!report.exists() || report.data().category !== "Alert") throw new Error("This alert is unavailable.");
        if (report.data().authorId === user.uid) throw new Error("Another verifier must review your own report.");
        if (report.data().rejection || report.data().resolution) throw Error("This report is closed. Reopen it to see the latest decision.");
        if (report.data().detailRequest && !report.data().clarification) throw Error("Waiting for the reporter's details.");
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

// Each review/response is immutable, preserving who decided and why. Rejected
// content is corrected by submitting a new report, never by changing approved text.
export async function reviewReport(user, postId, action, reason, expectedApproval = false) {
    const actor = identity(user), note = text(reason, 500, "Explanation");
    if (!["reject", "request_details"].includes(action)) throw Error("Choose a review decision.");
    const parent = doc(posts, postId);
    await runTransaction(db, async transaction => {
        const role = await transaction.get(doc(db, "users", user.uid, "roles", "verifier"));
        const snapshot = await transaction.get(parent), data = snapshot.data();
        if (role.data()?.enabled !== true) throw Error("Only an authorized verifier can review reports.");
        if (!data || data.category !== "Alert" || data.authorId === user.uid) throw Error("Another verifier must review your own report.");
        if (data.rejection || data.resolution) throw Error("This report has already been closed.");
        if (!!data.verification !== expectedApproval) throw Error("Another reviewer changed this report. Review the latest status before continuing.");
        if (action === "request_details" && (data.verification || data.detailRequest)) throw Error("Details have already been requested or this report is verified.");
        const field = action === "reject" ? "rejection" : "detailRequest";
        transaction.update(parent, { [field]: { by: user.uid, name: actor.name, at: serverTimestamp(), reason: note } });
    });
}
export async function clarifyReport(user, postId, body) {
    identity(user); const clean = text(body, 2000, "Additional details"), parent = doc(posts, postId);
    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(parent), data = snapshot.data();
        if (!data || data.authorId !== user.uid || !data.detailRequest || data.clarification || data.rejection || data.resolution || data.verification) throw Error("This report no longer needs a response. Reopen it to see its status.");
        transaction.update(parent, { clarification: { by: user.uid, at: serverTimestamp(), body: clean } });
    });
}

export async function setConfirmation(user, postId, confirmed) {
    // The per-user confirmation document and parent count change together.
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

export async function resolveReport(user, postId, note = "") {
    // Resolution is a one-time record; expiry is derived from createdAt and
    // therefore never needs a background status write.
    const author = identity(user);
    const clean = typeof note === "string" ? note.trim() : "";
    if (clean.length > 500) throw new Error("Resolution notes must be 500 characters or fewer.");
    const parent = doc(posts, postId);
    let attemptedWrite = false;
    try { await runTransaction(db, async transaction => {
        const report = await transaction.get(parent);
        if (!report.exists() || report.data().category !== "Alert") throw new Error("This alert is unavailable.");
        if (report.data().authorId !== user.uid) {
            const role = await transaction.get(doc(db, "users", user.uid, "roles", "verifier"));
            if (role.data()?.enabled !== true) throw new Error("Only the author or an authorized verifier can resolve this report.");
        }
        if (report.data().resolution?.status === "resolved") return;
        attemptedWrite = true;
        transaction.update(parent, { resolution: {
            status: "resolved", resolvedBy: user.uid, resolvedName: author.name, resolvedAt: serverTimestamp(), note: clean
        } });
    }); } catch (error) {
        if (attemptedWrite && error.code === "permission-denied"
            && (await getDocFromServer(parent)).data()?.resolution?.status === "resolved") return;
        throw error;
    }
}

export async function setAcceptedAnswer(user, postId, replyId) {
    identity(user);
    if (typeof replyId !== "string" || (replyId && !/^[A-Za-z0-9_-]{1,128}$/.test(replyId))) {
        throw new Error("Choose a valid reply.");
    }
    const parent = doc(posts, postId);
    await runTransaction(db, async transaction => {
        const post = await transaction.get(parent);
        if (!post.exists() || post.data().category !== "Question") throw new Error("This question is unavailable.");
        if (post.data().authorId !== user.uid) throw new Error("Only the question author can choose a helpful reply.");
        let answer = null;
        if (replyId) {
            const reply = await transaction.get(doc(parent, "replies", replyId));
            if (!reply.exists()) throw new Error("This reply is unavailable.");
            const data = reply.data();
            answer = { replyId, name: data.name, body: data.body, authorId: data.authorId };
        }
        // Immutable reply content is mirrored for safe, inexpensive feed previews.
        // Rules verify this map against the same-thread reply on every change.
        transaction.update(parent, { acceptedReplyId: replyId, acceptedAnswer: answer });
    });
}

export async function sendReply(user, postId, body, parentId = "") {
    if (typeof parentId !== "string" || (parentId && !/^[A-Za-z0-9_-]{1,128}$/.test(parentId))) {
        throw new Error("Choose a valid reply to respond to.");
    }
    const parent = doc(posts, postId);
    const reply = doc(collection(parent, "replies"));
    const batch = writeBatch(db);
    batch.set(reply, { ...identity(user), body: text(body, 2000, "Reply"), createdAt: serverTimestamp(), ...(parentId ? { parentId } : {}) });
    // Save the reply and count together, including when two people reply at once.
    batch.update(parent, { replyCount: increment(1), lastReplyId: reply.id, lastActivityAt: serverTimestamp() });
    await batch.commit();
    return reply.id;
}
