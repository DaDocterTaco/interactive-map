import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { authenticate, cli, liveRules, projectId } from './firebase-access.mjs';

await authenticate();
const [billingEnabled, current] = await Promise.all([cli('gcp/cloudbilling.js').checkBillingEnabled(projectId), liveRules()]);
const output = new URL('../.generated/deployment/', import.meta.url);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(new URL('live-before.rules', output), current.content);
const summary = { projectId, billingEnabled, rulesetName: current.release.rulesetName,
  rulesSha256: createHash('sha256').update(current.content).digest('hex'), checkedAt: new Date().toISOString() };
await fs.writeFile(new URL('preflight.json', output), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
