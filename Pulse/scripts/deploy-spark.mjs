import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { authenticate, liveRules, projectId, cli } from './firebase-access.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const apply = process.argv.includes('--apply');
await authenticate();
const before = await liveRules();
const billingEnabled = await cli('gcp/cloudbilling.js').checkBillingEnabled(projectId);
await fs.mkdir('.generated/deployment', { recursive: true });
await fs.writeFile('.generated/deployment/live-before-spark.rules', before.content);
execFileSync(process.execPath, ['scripts/merge-rules.mjs', '.generated/deployment/live-before-spark.rules'], { stdio: 'inherit' });
const combined = await fs.readFile('.generated/firestore.rules', 'utf8');
console.log(JSON.stringify({ projectId, mode: apply ? 'deploy-rules' : 'review', billingEnabled,
  sourceRuleset: before.release.rulesetName, combinedRulesSha256: hash(combined), functions: false, hosting: false }));
if (apply) {
  if (hash((await liveRules()).content) !== hash(before.content)) throw Error('Live rules changed. Review the latest rules before retrying.');
  const cliRoot = process.env.PULSE_FIREBASE_CLI_ROOT || path.join(homedir(), 'AppData/Roaming/npm/node_modules/firebase-tools');
  execFileSync(process.execPath, [path.join(cliRoot, 'lib/bin/firebase.js'), 'deploy', '--only', 'firestore:rules',
    '--project', projectId, '--config', 'firebase.json', '--non-interactive'], { stdio: 'inherit' });
  const after = await liveRules();
  if (hash(after.content) !== hash(combined)) throw Error('Post-deploy rules do not match the tested artifact.');
  const record = { projectId, billingEnabled, deployedAt: new Date().toISOString(), rulesetName: after.release.rulesetName,
    beforeSha256: hash(before.content), rulesSha256: hash(combined) };
  await fs.writeFile('.generated/deployment/spark-result.json', JSON.stringify(record, null, 2) + '\n');
  console.log('Verified deployed Firestore rules. No functions, hosting or billing changes.');
}
