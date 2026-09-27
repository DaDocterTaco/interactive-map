# Backend foundation — local handoff

## What is implemented

The `pulseAction` callable function authenticates the caller through Firebase Authentication and delegates to the transaction-backed service. It supports opt-in, matching, accept/decline, refresh/recovery, cancellation, leaving, and manual/automatic check-in. `pulseCleanup` is a scheduled lifecycle/retention function.

All runtime records use the hierarchy in [data-model.md](data-model.md). Meetup messages have exactly one path below their meetup. The campus revision acts as a transaction coordination point, appropriate for the three-device demo. Matching examines at most 100 waiting availability records and 100 spots per pass; groups contain two to four people. A larger campus launch needs queue partitioning/pagination and load testing, not merely higher instance limits.

Calls must follow an explicit opt-in. A view can call `match` after opting in and periodically while the person is waiting, and `refresh` on reconnect or a response deadline. Background matching/push delivery is not implemented. A scheduled sweep resolves proposals after their response deadline even if every client closes; the callable refresh path also resolves them immediately when requested.

Proposals wait for all invited users to answer or for the 45-second deadline. At least two still-valid acceptances are needed. Confirmation uses a deterministic ID derived from server-generated availability versions; retrying a response cannot create a duplicate meetup or reuse an old conversation. Declining, canceling, or an expired proposal returns the student to idle and removes private matching inputs. A future “keep looking” control that preserves the original availability deadline is not implemented in this foundation; the current API requires a deliberate new opt-in with a new request ID.

Timing accounts for estimated walking, a one-minute departure allowance, at least ten useful minutes together, a maximum 25-minute meetup, and a five-minute commitment buffer. These are demo policy values, not a guarantee of reaching an unknown next destination. Walk estimates are based on adjusted straight-line distance, not routed paths.

## Files and integration

- `backend/service.js`: trusted operations and lifecycle transitions.
- `backend/index.js`: callable API and scheduled cleanup exports.
- `backend/firestore.fragment.rules`: Pulse client permissions.
- `shared/policy.js`: time, distance, validation, and arrival policies.
- `client/service.js`: browser adapter accepting the existing Firebase app instance.
- `backend/spots.draft.json`: the three agreed spot entries, all disabled pending verification.
- `scripts/merge-rules.mjs`: combines the CURRENT app rules with the Pulse fragment and excludes Pulse from the unrelated-data fallback.
- `tests/`: policy, service/concurrency/rule integration, and actual callable/Auth-emulator tests.

The interface is integrated at `C:/Users/Victor/Desktop/Extra/HackAthon/interactive-map/Pulse`. The app's current rules were used to generate a combined local test ruleset; production rules have not been deployed. Generate again from the current source at deployment time so other work is preserved. A provenance file records the source hash. The merger fails if the expected structure changes or Pulse is already present; that situation requires an explicit reviewed merge.

No Firestore index deployment is configured: current queries use single-field indexes. This avoids applying an empty index file over unrelated application indexes.

The responsive UI and Firebase adapter are implemented. The Pulse dialog renders nested meetup messages using its participant-name snapshot. Automatic arrival has an explicit opt-in watcher with manual fallback. See [interface-setup.md](interface-setup.md) for app integration, browser rehearsal, and real-phone limits.

## Local commands

Run from the `Pulse` directory. `npm ci` installs exactly the committed package lock. A local Firebase CLI and Java 21 are needed for these emulator tests.

```powershell
npm.cmd ci --ignore-scripts
node scripts/merge-rules.mjs 'C:\Users\Victor\Desktop\Extra\HackAthon\interactive-map\LiveChat\firestore.rules'
npm.cmd test
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.local-config'
$env:FIREBASE_EMULATORS_PATH = 'C:\Users\Victor\.cache\firebase\emulators'
firebase emulators:exec --only firestore,auth,functions --project demo-campus-pulse --config firebase.json 'node --test --test-concurrency=1 tests/callable.test.mjs tests/integration.test.mjs'
```

The example `XDG_CONFIG_HOME` creates an isolated local CLI configuration for testing; it does not use saved production login credentials. If the machine has no cached emulator binaries, let Firebase download its required emulators through its normal setup. The scripts assert the local emulator host and use the non-production `demo-campus-pulse` project. The integration suite clears only that local test database between cases.

For a manual local API exercise, start the emulators and seed the fixture using `npm run seed:emulator` with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8197` and `GCLOUD_PROJECT=demo-campus-pulse`. The seed script refuses a real project. Its fixture is synthetic and must never be imported as a verified real campus location.

## API

Send `{ campusId: 'mmc', action, input }` to `pulseAction` using the Firebase callable SDK. Never send an authentication UID as a substitute for a signed-in Firebase user.

| Action | Input |
| --- | --- |
| `optIn` | Unique `requestId`, `minutes` (15–120), `activities` from coffee/food/chat, `maxWalkMinutes` (1–20), and either a verified `startingSpotId` or a fresh `position` |
| `match` | None; searches only for the authenticated user's existing availability |
| `respond` | `proposalId`, `decision: 'accept'` or `'decline'` |
| `refresh` | None; rechecks/restores the user's current state |
| `cancel` | None; cancels waiting availability or withdraws from a pending proposal |
| `leave` | `meetupId`; removes the caller, canceling the group if fewer than two remain |
| `checkIn` | `meetupId`, `method: 'manual'` or `'automatic'`; automatic also sends two fresh fixes |

Position/fix format: `{ latitude, longitude, accuracy, capturedAt }`, with accuracy in meters and capturedAt as epoch milliseconds. Automatic arrival needs two distinct readings spanning at least ten seconds, both within 15 seconds of the backend clock, each accuracy no worse than 25 meters, and each distance-plus-accuracy within 40 meters of the meeting point. Readings must be after confirmation. Only the check-in result is persisted. These parameters require testing on campus phones, especially indoors.

Use `client/service.js` to subscribe to database changes. Message writes go to `pulse/{campusId}/meetups/{meetupId}/messages`, with `senderId`, `text`, and `serverTimestamp()` as `createdAt`. Client rules enforce participant membership, sender identity, and chat expiration. Other state changes are backend-only.

## Validation performed

Local tests on 2026-09-27:

- Four pure policy tests: compatible groups, elapsed time, walking limits, and accurate/fresh arrival fixes.
- Twelve Firestore service/rules integration scenarios, including concurrent matching and acceptance, private availability, unrelated chat/profile regression checks, accepted-only realtime chat, deadlines, invalidated spots, check-in, leaving, nested cleanup, and request-reuse behavior.
- One end-to-end callable test using three independently authenticated anonymous sessions through the Auth and Functions emulators. An unauthenticated call was denied, and a forged payload UID did not affect participant identity.

The environment uses Node 24.15.0; the deployment is configured for supported Node 22. The Functions emulator used the host Node version, so a Node 22/cloud smoke test remains part of deployment validation. The scheduled function's underlying sweep is tested directly; real Cloud Scheduler execution is not claimed.

## Deployment handoff

Deployment is not performed. Before publishing the demo, verify/enable real spot pins, verify the Firebase project and account access, and review the combined rules against the current source. Public client hosting must exclude backend code, tests, local configuration, and credentials. A hosting configuration has not been added yet.

For rules deployment the config's predeploy hook requires `PULSE_BASE_RULES` to point at the current application rules. Use an explicit real project ID when deploying. Do not upload the synthetic test spot or import emulator users/data into the real project. Confirm deployment prerequisites and any account/billing changes at that stage; this work has made none.

The production package override pins the older gaxios 6 dependency's uuid to the compatible 11.1.1 release, matching the current campus app's dependency fix. Keep this documented when upgrading Firebase Admin.
