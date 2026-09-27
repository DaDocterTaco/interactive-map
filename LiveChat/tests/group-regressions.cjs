const { spawnSync } = require('node:child_process');
const path = require('node:path');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw Error('Only the local emulator is allowed.');
for (const test of ['groups.test.mjs', 'appearance-rules.test.mjs', 'moderation.test.mjs', 'people.test.mjs']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, test)], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status || 1);
}
