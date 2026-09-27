import { Timestamp } from 'firebase-admin/firestore';
export const TEST_POSITION = { latitude: 25.7565, longitude: -80.3724 };
export async function seed(db, campusId = 'mmc') {
  const root = db.doc(`pulse/${campusId}`);
  const batch = db.batch();
  batch.set(root, { enabled: true, displayName: 'Emulator test campus', schemaVersion: 1, revision: 0,
    bounds: [25.748, -80.387, 25.765, -80.364], updatedAt: Timestamp.now() });
  batch.set(root.collection('spots').doc('test-spot'), { ...TEST_POSITION, name: 'EMULATOR ONLY meeting point',
    instruction: 'Synthetic test point; not a verified campus meeting location.',
    activities: ['coffee', 'food', 'chat'], enabled: true, verified: true });
  await batch.commit();
}
export function optInInput(name, overrides = {}) {
  return { requestId: `request-${name}`, minutes: 45, maxWalkMinutes: 5, activities: ['coffee'], startingSpotId: 'test-spot', ...overrides };
}
