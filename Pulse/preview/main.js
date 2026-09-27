import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence, signInAnonymously, updateProfile, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { mountPulse } from '../client/pulse.js';

// This entrypoint is deliberately separate from production mount.js and refuses remote hosting.
if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw Error('Local rehearsal only.');
const device = new URLSearchParams(location.search).get('device') || '1';
if (!/^[1-3]$/.test(device)) throw Error('Choose rehearsal device 1, 2, or 3.');

if (new URLSearchParams(location.search).has('shell')) {
  const styles = document.createElement('link'); styles.rel = 'stylesheet'; styles.href = '/CampusUI/campus.css'; document.head.append(styles);
  document.body.classList.add('map-page');
  await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/CampusUI/shell.js'; script.onload = resolve; script.onerror = reject; document.head.append(script); });
  document.getElementById('page-classes').innerHTML = '<div style="padding:24px"><h1>Class search rehearsal</h1><p>This test surface checks that Pulse can notify you while you use another tab.</p><label>Search classes <input aria-label="Rehearsal class search" placeholder="Try typing while Pulse searches"></label><p><button type="button" id="test-modal-open">Open a test dialog</button></p></div>';
  const testDialog = document.createElement('dialog'); testDialog.id = 'rehearsal-modal'; testDialog.innerHTML = '<h2>Keep your place</h2><p>Pulse alerts should stay clickable here without stealing focus.</p><label>Rehearsal note <input aria-label="Rehearsal note"></label><p><label><input type="checkbox" aria-label="Protect unsaved changes"> Protect unsaved changes</label></p><p><button type="button">Close test dialog</button></p>'; document.body.append(testDialog);
  testDialog.addEventListener('cancel', event => { if (testDialog.querySelector('[type=checkbox]').checked) event.preventDefault(); });
  document.getElementById('test-modal-open').addEventListener('click', () => testDialog.showModal()); testDialog.querySelector('button').addEventListener('click', () => testDialog.close());
  document.querySelector('.rehearsal').style.cssText = 'left:20px;top:20px;bottom:auto;right:20px;max-width:none;padding:5px 10px;z-index:760;font-size:10px;pointer-events:none';
}
document.getElementById('device').textContent = `Device ${device}`;
const app = initializeApp({ projectId: 'demo-campus-pulse', apiKey: 'emulator-only' }, `pulse-rehearsal-${device}`);
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9107', { disableWarnings: true });
// Three browser tabs share one HTTP/1 emulator connection pool. Short polling
// avoids long queued writes during local rehearsal; production uses its defaults.
connectFirestoreEmulator(initializeFirestore(app, { experimentalForceLongPolling: true, experimentalLongPollingOptions: { timeoutSeconds: 5 } }), '127.0.0.1', 8197);
await setPersistence(auth, browserLocalPersistence);
const map = L.map('map', { zoomControl: false }).setView([25.7565, -80.374], 17);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
mountPulse({ app, map, L, campusId: 'ui-rehearsal', demoLabel: `Local rehearsal · Device ${device} · Firebase emulator`, auth: {
  restore: async () => { await auth.authStateReady(); return auth.currentUser; },
  watch: callback => onAuthStateChanged(auth, callback),
  join: async name => { if (!name.trim() || name.trim().length > 40) throw Error('Enter a name between 1 and 40 characters.'); const user = auth.currentUser || (await signInAnonymously(auth)).user; await updateProfile(user, { displayName: name.trim() }); return user; },
} });
