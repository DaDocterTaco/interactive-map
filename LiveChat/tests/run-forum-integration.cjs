const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const file of ['forums.test.mjs', 'forum-features.test.mjs', 'alerts.test.mjs', 'verification.test.mjs', 'report-lifecycle.test.mjs']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS: all forum, topic, nested reply, helpful answer, bookmark, alert, verification, and lifecycle integration suites.');
