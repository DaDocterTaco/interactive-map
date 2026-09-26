// A fake clock checks the exact deadline and refresh after tab visibility changes.
const assert = require('node:assert/strict');
let now = 100000000, callback, delay, visible, removed = false, fired = 0;
const life = require('./lifecycle-helper.cjs')({ Date: class extends Date { static now() { return now; } }, setTimeout(fn, ms) { callback = fn; delay = ms; return 1; }, clearTimeout() {}, document: { visibilityState: 'visible', addEventListener(type, fn) { visible = fn; }, removeEventListener() { removed = true; } } });
const deadline = now + 1000;
const report = { category: 'Alert', createdAt: { toMillis: () => deadline - life.WARNING_LIFETIME_MS } };
assert.equal(life.reportState(report), 'active');
assert.equal(life.reportState(report, deadline), 'expired');
assert.equal(life.reportState({ ...report, resolution: { status: 'resolved' } }, deadline), 'resolved');
assert.equal(life.reportState({ category: 'Alert' }), 'expired');
const clock = life.watchReportExpiry(() => [report], () => fired++);
clock.refresh(); assert.equal(delay, 1000);
now = deadline; callback(); assert.equal(fired, 1);
visible(); assert.equal(fired, 2);
clock.dispose(); visible(); assert.equal(fired, 2); assert.equal(removed, true);
console.log('PASS: exact 24-hour boundary, resolution priority, missing-date exclusion, timed expiration, tab resume, clock disposal.');
