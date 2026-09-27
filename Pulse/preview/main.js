import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence, signInAnonymously, updateProfile, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { mountPulse } from '../client/pulse.js';

// This entrypoint is deliberately separate from production mount.js and refuses remote hosting.
if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw Error('Local rehearsal only.');
const device = new URLSearchParams(location.search).get('device') || '1';
if (!/^[1-3]$/.test(device)) throw Error('Choose rehearsal device 1, 2, or 3.');
document.getElementById('device').textContent = `Device ${device}`;
const app = initializeApp({ projectId: 'demo-campus-pulse', apiKey: 'emulator-only' }, `pulse-rehearsal-${device}`);
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9107', { disableWarnings: true });
connectFirestoreEmulator(getFirestore(app), '127.0.0.1', 8197);
connectFunctionsEmulator(getFunctions(app, 'us-central1'), '127.0.0.1', 5017);
await setPersistence(auth, browserLocalPersistence);
const map = L.map('map', { zoomControl: false }).setView([25.7565, -80.374], 17);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
mountPulse({ app, map, L, campusId: 'rehearsal', demoLabel: `LOCAL REHEARSAL · Device ${device}. Synthetic spot; no real campus meetup.`, auth: {
  restore: async () => { await auth.authStateReady(); return auth.currentUser; },
  watch: callback => onAuthStateChanged(auth, callback),
  join: async name => { if (!name.trim() || name.trim().length > 40) throw Error('Enter a name between 1 and 40 characters.'); const user = auth.currentUser || (await signInAnonymously(auth)).user; await updateProfile(user, { displayName: name.trim() }); return user; },
} });
