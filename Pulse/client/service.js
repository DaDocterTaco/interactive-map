import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import * as sdk from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { createFirestoreEngine } from './firestore-engine.js';
import { millis } from '../shared/policy.js';

export function createPulseClient(app, campusId = 'mmc') {
  const db = sdk.getFirestore(app), engine = createFirestoreEngine({ db, sdk, campusId, actor: () => getAuth(app).currentUser });
  const { root, ref } = engine;
  const value = snapshot => snapshot.exists() ? { id: snapshot.id, ...snapshot.data(), fromCache: snapshot.metadata.fromCache } : null;
  const watch = (reference, callback, onError) => sdk.onSnapshot(reference, { includeMetadataChanges: true }, snapshot => callback(value(snapshot)), onError);
  let stateNotify = () => {};
  function watchState(uid, cb, error) {
    let ticket = null, proposal = null, id = null, stopPlan = () => {}, timer = null, disposed = false;
    const emit = () => {
      if (disposed) return;
      clearTimeout(timer);
      const state = engine.result(ticket, proposal);
      cb({ ...state, fromCache: !!ticket?.fromCache || !!proposal?.fromCache });
      const next = state.status === 'waiting' ? millis(ticket?.expiresAt) : state.status === 'confirmed' ? millis(proposal?.endsAt) : null;
      if (next > Date.now()) timer = setTimeout(emit, Math.min(next - Date.now() + 50, 2_000_000_000));
    };
    stateNotify = emit;
    const stopTicket = watch(ref('availability', uid), next => {
      ticket = next;
      const nextId = next?.proposalId || null;
      if (nextId !== id) {
        stopPlan(); proposal = null; id = nextId;
        if (id) {
          const expected = id;
          stopPlan = watch(ref('proposals', id), p => { if (expected === id) { proposal = p; emit(); } }, error);
          return;
        }
      }
      emit();
    }, error);
    return () => { disposed = true; clearTimeout(timer); stopPlan(); stopTicket(); if (stateNotify === emit) stateNotify = () => {}; };
  }
  return {
    action: async (action, input = {}) => { const result = await engine.action(action, input); stateNotify(); return result; },
    watchCampus: (cb, error) => sdk.onSnapshot(root, { includeMetadataChanges: true }, snapshot => cb({
      exists: snapshot.exists(), data: snapshot.data() ?? null, fromCache: snapshot.metadata.fromCache,
    }), error),
    watchState,
    watchAvailability: (uid, cb, error) => watch(ref('availability', uid), cb, error),
    watchProposal: (id, cb, error) => watch(ref('proposals', id), cb, error),
    watchMeetup: (id, cb, error) => watch(ref('proposals', id), p => {
      if (!p) return cb(null);
      const participantIds = engine.active(p);
      cb({ ...p, participantIds, status: participantIds.length < 2 ? 'canceled' : millis(p.endsAt) <= Date.now() ? 'ended' : p.status });
    }, error),
    watchSpots: (cb, error) => sdk.onSnapshot(sdk.collection(root, 'spots'), snapshot => cb(snapshot.docs.map(value)), error),
    watchCheckIns: (id, cb, error) => sdk.onSnapshot(sdk.collection(ref('proposals', id), 'checkIns'), snapshot => cb(snapshot.docs.map(d => d.data())), error),
    watchMessages: (id, cb, error) => sdk.onSnapshot(sdk.query(sdk.collection(ref('proposals', id), 'messages'), sdk.orderBy('createdAt'), sdk.limitToLast(100)),
      { includeMetadataChanges: true }, snapshot => cb(snapshot.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pending: d.metadata.hasPendingWrites })), snapshot.metadata.fromCache), error),
    sendMessage: async (uid, meetupId, text) => {
      const message = text.trim();
      if (!message || message.length > 2000) throw Error('Messages must contain 1 to 2000 characters.');
      return sdk.addDoc(sdk.collection(ref('proposals', meetupId), 'messages'), { senderId: uid, text: message, createdAt: sdk.serverTimestamp() });
    },
  };
}
