import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { seed } from '../tests/fixtures.mjs';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8197') throw Error('This seed script only runs against the local Pulse emulator.');
const projectId = process.env.GCLOUD_PROJECT || 'demo-campus-pulse';
if (projectId !== 'demo-campus-pulse') throw Error('Refusing to seed a real Firebase project.');
initializeApp({ projectId });
await seed(getFirestore(), 'rehearsal');
console.log('Seeded one explicitly synthetic meeting spot in the local emulator. No real students or production data were created.');
