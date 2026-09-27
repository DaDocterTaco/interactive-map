import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { getFirestore, doc, collection, onSnapshot, query, orderBy, limitToLast, addDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Pass the existing app instance; this does not create another account or app.
// The Pulse view supplies the existing authenticated user and renders data
// as text. These listeners must be disposed when switching account or campus.
export function createPulseClient(app, campusId = 'mmc') {
  if (!/^[a-z0-9_-]+$/.test(campusId)) throw Error('Invalid campus.');
  const db = getFirestore(app), root = doc(db, 'pulse', campusId);
  const invoke = httpsCallable(getFunctions(app, 'us-central1'), 'pulseAction');
  const watch = (reference, callback, onError) => onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
    callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data(), fromCache: snapshot.metadata.fromCache } : null);
  }, onError);
  return {
    action: async (action, input = {}) => (await invoke({ campusId, action, input })).data,
    watchCampus: (cb, error) => onSnapshot(root, { includeMetadataChanges: true }, snapshot => cb({
      exists: snapshot.exists(), data: snapshot.data() ?? null, fromCache: snapshot.metadata.fromCache,
    }), error),
    watchState: (uid, cb, error) => watch(doc(root, 'memberState', uid), cb, error),
    watchAvailability: (uid, cb, error) => watch(doc(root, 'availability', uid), cb, error),
    watchProposal: (id, cb, error) => watch(doc(root, 'proposals', id), cb, error),
    watchMeetup: (id, cb, error) => watch(doc(root, 'meetups', id), cb, error),
    watchSpots: (cb, error) => onSnapshot(collection(root, 'spots'), snapshot => cb(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))), error),
    watchCheckIns: (id, cb, error) => onSnapshot(collection(root, 'meetups', id, 'checkIns'), snapshot => cb(snapshot.docs.map(d => d.data())), error),
    watchMessages: (id, cb, error) => onSnapshot(query(collection(root, 'meetups', id, 'messages'), orderBy('createdAt'), limitToLast(100)),
      { includeMetadataChanges: true }, snapshot => cb(snapshot.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pending: d.metadata.hasPendingWrites })), snapshot.metadata.fromCache), error),
    sendMessage: async (uid, meetupId, text) => {
      const message = text.trim();
      if (!message || message.length > 2000) throw Error('Messages must contain 1 to 2000 characters.');
      return addDoc(collection(root, 'meetups', meetupId, 'messages'), { senderId: uid, text: message, createdAt: serverTimestamp() });
    },
  };
}
