import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const target = process.argv[2] && path.resolve(process.argv[2]);
if (!target || path.basename(target) !== 'firestore.rules') throw Error('Provide the canonical application rules file.');
const hash = text => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
const current = await fs.readFile(target, 'utf8');
const candidate = '.generated/deployment/app-with-pulse.rules';
execFileSync(process.execPath, ['scripts/merge-rules.mjs', target, candidate], { stdio: 'inherit' });
const combined = await fs.readFile(candidate, 'utf8');
if (hash(current) === hash(combined)) { console.log('Canonical app rules already match.'); process.exit(0); }
if (process.argv.includes('--apply')) {
  if (hash(await fs.readFile(target, 'utf8')) !== hash(current)) throw Error('Application rules changed during preparation; retry the merge.');
  await fs.writeFile('.generated/deployment/app-rules-before-spark.rules', current);
  await fs.writeFile(target, combined);
  console.log('Added the tested Pulse block to canonical app rules, preserving all current local policies; backup retained.');
} else console.log('Reviewed canonical rules; safe to synchronize the Pulse block.');
