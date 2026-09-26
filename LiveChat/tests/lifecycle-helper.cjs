// Evaluate the browser lifecycle module with injected clock and document APIs
// so deadline tests can advance time deterministically.
const fs = require('node:fs'), path = require('node:path');
module.exports = (options = {}) => {
    const code = fs.readFileSync(path.join(__dirname, '../forums/reportLifecycle.js'), 'utf8').replaceAll('export ', '');
    return new Function('document', 'setTimeout', 'clearTimeout', 'Date', code + '\nreturn {expiresAt, reportState, watchReportExpiry, WARNING_LIFETIME_MS};')(
        options.document || { addEventListener() {}, removeEventListener() {} }, options.setTimeout || (() => 0), options.clearTimeout || (() => {}), options.Date || Date);
};
