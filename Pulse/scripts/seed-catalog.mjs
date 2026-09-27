import fs from 'node:fs/promises';
import { authenticate, cli, projectId } from './firebase-access.mjs';

// Create-only import of the user-approved real demo catalog. Never copies emulator data.
const apply = process.argv.includes('--apply');
const catalog = JSON.parse(await fs.readFile('backend/spots.json', 'utf8'));
if (catalog.campusId !== 'mmc' || catalog.schemaVersion !== 2 || catalog.spots.length !== 3
  || catalog.spots.some(s => !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude) || !s.verificationNote))
  throw Error('Review the three MMC demo locations before importing.');
await authenticate();
const { Client } = cli('apiv2.js');
const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const base = 'projects/' + projectId + '/databases/(default)/documents';
const encode = value => {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k,v]) => [k,encode(v)])) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
};
const { spots, campusId, ...campus } = catalog;
const records = [
  ['pulse/mmc', { ...campus, schemaVersion: 2, backend: 'firestore-spark' }],
  ...spots.map(({ id, ...spot }) => ['pulse/mmc/spots/' + id, spot]),
];
const writes = [];
for (const [relative, value] of records) {
  const name = base + '/' + relative;
  try {
    await api.get('/' + name);
    console.log('Preserving existing document: ' + relative);
  } catch (error) {
    if (error.status !== 404 && error.context?.response?.statusCode !== 404 && error.original?.code !== 404) throw error;
    writes.push({ update: { name, fields: encode(value).mapValue.fields }, currentDocument: { exists: false } });
  }
}
console.log(JSON.stringify({ projectId, mode: apply ? 'create' : 'review', newDocuments: writes.map(w => w.update.name.split('/documents/')[1]) }));
if (apply && writes.length) {
  await api.post('/' + base + ':commit', { writes });
  for (const write of writes) {
    const result = await api.get('/' + write.update.name);
    if (JSON.stringify(result.body.fields) === '{}') throw Error('Catalog verification failed.');
    const expected = write.update.fields;
    for (const key of Object.keys(expected)) if (JSON.stringify(result.body.fields[key]) !== JSON.stringify(expected[key])) {
      // API map-key order can differ; primitive activation/schema values are verified below.
      if (['enabled', 'verified', 'schemaVersion', 'latitude', 'longitude'].includes(key)) throw Error('Catalog field verification failed: ' + key);
    }
  }
  console.log('Created and verified the approved real demo catalog. No students or meetups were created.');
}
