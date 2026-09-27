import { authenticate, cli, projectId } from './firebase-access.mjs';
// Explicit maintenance on Spark; dry-run unless --apply. Never uses TTL or a paid scheduler.
const apply = process.argv.includes('--apply'), now = Date.now();
await authenticate();
const { Client } = cli('apiv2.js');
const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const base = 'projects/' + projectId + '/databases/(default)/documents';
const parent = base + '/pulse/mmc';
async function expired(collectionId, fieldPath, cutoff) {
  const response = await api.post('/' + parent + ':runQuery', { structuredQuery: {
    from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath }, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: new Date(cutoff).toISOString() } } }, limit: 50,
  } });
  return response.body.filter(item => item.document).map(item => item.document);
}
async function children(name, collectionId) {
  const docs = []; let pageToken;
  do {
    const queryParams = { pageSize: 300, ...(pageToken ? { pageToken } : {}) };
    const response = await api.get('/' + name + '/' + collectionId, { queryParams });
    docs.push(...(response.body.documents || [])); pageToken = response.body.nextPageToken;
  } while (pageToken);
  return docs;
}
async function remove(docs) {
  for (let start = 0; start < docs.length; start += 400) {
    await api.post('/' + base + ':commit', { writes: docs.slice(start, start + 400).map(d => ({
      delete: d.name, currentDocument: { updateTime: d.updateTime },
    })) });
  }
}
const plans = await expired('proposals', 'deleteAfter', now);
const tickets = await expired('availability', 'expiresAt', now - 10 * 60000);
let nested = 0;
for (const plan of plans) {
  const docs = [...await children(plan.name, 'messages'), ...await children(plan.name, 'checkIns')];
  nested += docs.length;
  if (apply) { await remove(docs); await remove([plan]); }
}
if (apply) await remove(tickets);
console.log(JSON.stringify({ projectId, campus: 'mmc', mode: apply ? 'removed-expired-records' : 'dry-run',
  proposals: plans.length, messagesAndCheckIns: nested, expiredAvailability: tickets.length, batchLimit: 50 }));
