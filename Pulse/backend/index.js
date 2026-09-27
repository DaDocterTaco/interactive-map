import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { PulseService } from './service.js';
import { PulseError } from '../shared/policy.js';

initializeApp();
const db = getFirestore();
const service = new PulseService(db);

export const pulseAction = onCall({ region: 'us-central1', maxInstances: 2, timeoutSeconds: 60 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use Pulse.');
  try {
    return await service.action({ uid: request.auth.uid, name: request.auth.token.name },
      request.data?.campusId, request.data?.action, request.data?.input ?? {});
  } catch (error) {
    if (error instanceof PulseError) throw new HttpsError(error.code, error.message);
    // Do not log request bodies or location data.
    console.error('Pulse operation failed', { code: String(error.code || 'internal') });
    throw new HttpsError('internal', 'Pulse could not save that change. Try again.');
  }
});

export const pulseCleanup = onSchedule({ region: 'us-central1', schedule: 'every 1 minutes', maxInstances: 1,
  timeoutSeconds: 120, retryCount: 1 }, async () => {
  // Run for disabled campuses too, so disabling a demo does not strand private data.
  const campuses = await db.collection('pulse').get();
  for (const campus of campuses.docs) await service.sweep(campus.id);
});
