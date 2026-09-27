const { spawnSync } = require('node:child_process');
const path = require('node:path');
(async () => {
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Use the local demo emulator');
for (const file of ['forums.test.mjs', 'forum-features.test.mjs', 'alerts.test.mjs', 'verification.test.mjs', 'report-lifecycle.test.mjs', 'report-review.test.mjs', 'map-warnings.test.mjs']) {
    const reset = await fetch('http://127.0.0.1:8185/emulator/v1/projects/demo-fiu-chat/databases/(default)/documents', { method: 'DELETE' });
    if (!reset.ok) throw Error('Could not reset synthetic emulator data');
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS: all forum, topic, nested reply, helpful answer, bookmark, alert, verification, and lifecycle integration suites.');
})().catch(error => { console.error(error); process.exitCode = 1; });
