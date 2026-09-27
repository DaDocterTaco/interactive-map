import { app } from "../firebase.js";
import { getFirestore, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Subscribe to approved reports independently of forum list pagination.
// One equality query also includes older approved alerts beyond the forum's
// paginated list. No compound index or separate copy of reports is needed.
export function watchVerifiedWarnings(onWarnings, onError) {
    const approved = query(collection(getFirestore(app), "forums"), where("verification.status", "==", "approved"));
    return onSnapshot(approved, { includeMetadataChanges: true }, snapshot => {
        // Do not put a locally pending approval on the map before it is saved.
        if (snapshot.metadata.hasPendingWrites) return;
        onWarnings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), snapshot.metadata.fromCache);
    }, onError);
}
