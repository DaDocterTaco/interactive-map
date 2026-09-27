import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

// Initialize Firebase Admin by pointing directly to your key file
initializeApp({
  credential: cert('./service-account.json')
});

const db = getFirestore();

async function exportAlertsToJSON() {
  try {
    console.log('Fetching active forum alerts...');
    
    // Query only posts where category is 'Alert'
    const snapshot = await db.collection('forums')
      .where('category', '==', 'Alert')
      .get();

    const alerts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Save to your JSON file
    fs.writeFileSync('forum_alerts.json', JSON.stringify(alerts, null, 2));
    
    console.log(`Success! Exported ${alerts.length} alerts to forum_alerts.json`);
  } catch (error) {
    console.error('Error exporting alerts:', error);
  }
}

exportAlertsToJSON();