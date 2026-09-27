import fs from 'node:fs/promises';
import { authenticate, liveRules, projectId, cli } from './firebase-access.mjs';
await authenticate();
const [live, billingEnabled] = await Promise.all([liveRules(), cli('gcp/cloudbilling.js').checkBillingEnabled(projectId)]);
const fragment = (await fs.readFile('backend/firestore.fragment.rules', 'utf8')).trim().replaceAll('\r\n', '\n');
if (!live.content.replaceAll('\r\n', '\n').includes(fragment)) throw Error('The live Pulse rules differ from this release.');
const { Client } = cli('apiv2.js');
const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const base = '/projects/' + projectId + '/databases/(default)/documents/pulse/mmc';
const campus = (await api.get(base)).body.fields;
const spots = [];
for (const id of ['gc-cafe-bustelo', 'chick-fil-a', 'pond-benches']) {
  const f = (await api.get(base + '/spots/' + id)).body.fields;
  spots.push({ id, name: f.name.stringValue, enabled: f.enabled.booleanValue, verified: f.verified.booleanValue });
}
if (billingEnabled || campus.enabled.booleanValue !== true || spots.some(s => !s.enabled || !s.verified))
  throw Error('The Spark demo verification did not match the intended configuration.');
const result = { projectId, checkedAt: new Date().toISOString(), billingEnabled, campusEnabled: true,
  backend: campus.backend.stringValue, ruleset: live.release.rulesetName, spots };
await fs.writeFile('.generated/deployment/spark-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
