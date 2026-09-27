import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2] || process.env.PULSE_BASE_RULES;
if (!sourcePath) throw Error('Pass the CURRENT application firestore.rules path. A Pulse-only ruleset must not replace the app rules.');
const original = await fs.readFile(sourcePath, 'utf8');
const managed = /    \/\/ PULSE MANAGED RULES BEGIN[\s\S]*?    \/\/ PULSE MANAGED RULES END\r?\n?/g;
if ([...original.matchAll(managed)].length > 1) throw Error('Duplicate managed Pulse rules; review before deployment.');
const source = original.replace(managed, '');
if (source.includes('match /pulse/')) throw Error('Unmanaged Pulse rules already exist. Review the merge explicitly.');
const fallback = /!\(collection in \[([^\]]+)\]\)/g;
if ([...source.matchAll(fallback)].length !== 1) throw Error('Expected exactly one known fallback; review this ruleset before integrating.');
let merged = source.replace(fallback, (_, list) => `!(collection in [${list}${/['"]pulse['"]/.test(list) ? '' : ", 'pulse'"}])`);
const fragment = await fs.readFile(path.join(root, 'backend/firestore.fragment.rules'), 'utf8');
if (!/\r?\n  }\r?\n}\s*$/.test(merged)) throw Error('Unexpected rules structure; refusing an automatic merge.');
merged = merged.replace(/\r?\n  }\r?\n}\s*$/, `\n${fragment}\n  }\n}\n`);
await fs.mkdir(path.join(root, '.generated'), { recursive: true });
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, '.generated/firestore.rules');
await fs.writeFile(output, merged);
await fs.writeFile(path.join(root, '.generated/rules-source.json'), JSON.stringify({
  source: path.resolve(sourcePath), sha256: createHash('sha256').update(original).digest('hex'), generatedAt: new Date().toISOString(),
}, null, 2) + '\n');
console.log('Prepared combined app + Pulse rules; existing policies preserved and Pulse excluded from the open fallback.');
