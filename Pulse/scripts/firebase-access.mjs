import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

// Reuse the installed Firebase CLI's account without copying credentials into this project.
// Never print account objects or tokens. Only use these clients for the explicit project below.
export const projectId = 'hackathon2026-bfbf3';
const require = createRequire(import.meta.url);
const cliRoot = process.env.PULSE_FIREBASE_CLI_ROOT || path.join(homedir(), 'AppData/Roaming/npm/node_modules/firebase-tools');
export const cli = relative => require(path.join(cliRoot, 'lib', relative));
export async function authenticate() {
  const { getProjectDefaultAccount } = cli('auth.js');
  const account = getProjectDefaultAccount(process.cwd());
  if (!account) throw Error('Sign in with firebase login before deploying.');
  await cli('requireAuth.js').requireAuth({ project: projectId, projectId, nonInteractive: true, ...account });
}
export async function liveRules() {
  const rules = cli('gcp/rules.js');
  const releases = await rules.listAllReleases(projectId);
  const release = releases.find(r => r.name === `projects/${projectId}/releases/cloud.firestore`
    || r.name === `projects/${projectId}/releases/cloud.firestore/(default)`);
  if (!release) throw Error('No default Firestore rules release found; refusing to replace an unknown ruleset.');
  const files = await rules.getRulesetContent(release.rulesetName);
  if (files.length !== 1) throw Error('Review the multi-file ruleset before deployment.');
  return { release, content: files[0].content };
}
