import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2] || process.env.PULSE_BASE_RULES;
if (!sourcePath) throw Error('Pass the CURRENT application firestore.rules path. A Pulse-only ruleset must not replace the app rules.');
const source = await fs.readFile(sourcePath, 'utf8');
if (source.includes('match /pulse/')) throw Error('Pulse rules already exist in the source. Review the merge explicitly.');
const fallback = /!\(collection in \[([^\]]+)\]\)/g;
if ([...source.matchAll(fallback)].length !== 1) throw Error('Expected exactly one known fallback; review this ruleset before integrating.');
let merged = source.replace(fallback, (_, list) => `!(collection in [${list}, 'pulse'])`);
const fragment = await fs.readFile(path.join(root, 'backend/firestore.fragment.rules'), 'utf8');
if (!/\r?\n  }\r?\n}\s*$/.test(merged)) throw Error('Unexpected rules structure; refusing an automatic merge.');
merged = merged.replace(/\r?\n  }\r?\n}\s*$/, `\n${fragment}\n  }\n}\n`);
await fs.mkdir(path.join(root, '.generated'), { recursive: true });
await fs.writeFile(path.join(root, '.generated/firestore.rules'), merged);
await fs.writeFile(path.join(root, '.generated/rules-source.json'), JSON.stringify({
  source: path.resolve(sourcePath), sha256: createHash('sha256').update(source).digest('hex'), generatedAt: new Date().toISOString(),
}, null, 2) + '\n');
console.log('Prepared combined app + Pulse rules; existing policies preserved and Pulse excluded from the open fallback.');
