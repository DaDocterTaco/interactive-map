# Firestore Spark backend

## Architecture

client/firestore-engine.js runs the matching workflow through the Firebase web SDK. client/service.js adapts document snapshots to the existing UI. There are no callable functions or scheduled functions in firebase.json.

A waiting user's availability document contains a name, selected activities, availability end, and an integer walking estimate for each reachable meeting spot. Exact positions never leave the phone. Other authenticated users can discover waiting availability so their app can propose a compatible group.

Creating a proposal and reserving all candidate tickets is one transaction. Security Rules require every selected ticket to be reserved for that proposal in the same commit. Each ticket's rules check its version, activity, walking estimate, name and time window against the proposal. Two proposals cannot reserve the same live ticket.

Each candidate can write only their own response. Accepting cannot modify another response or group membership. A separate transaction confirms after everyone responds or the deadline passes, and the rules independently derive the accepted membership. The proposal itself becomes the meetup, giving one permanent chat path. Leaving appends only the caller to departedIds. Fewer than two remaining members closes the group.

Firebase server request time controls write deadlines. Device clocks should be automatic; proposal creation allows a small clock tolerance, while late acceptance is rejected by server time.

## Timing and arrival

The offer window is about 45 seconds. A plan includes a one-minute departure allowance, conservative straight-line walking estimates, 10–25 minutes together, and a five-minute availability buffer. No route or next-class arrival guarantee is made.

Manual arrival is always available for an active member. Automatic arrival needs two fresh readings at least ten seconds apart, both accurate to 25m or better, with distance plus accuracy inside 40m of the meeting pin. These checks run locally; Firestore stores only uid, method and checkedInAt. This is a self-reported arrival feature, not an anti-spoof attendance system.

## Local tests

Run from Pulse:

    npm.cmd ci --ignore-scripts
    node scripts/merge-rules.mjs 'C:\Users\Victor\Desktop\Extra\HackAthon\interactive-map\LiveChat\firestore.rules'
    npm.cmd test
    firebase emulators:exec --only firestore,auth --project demo-campus-pulse --config firebase.json "npm.cmd run test:integration"

For already running emulators, set FIRESTORE_EMULATOR_HOST to 127.0.0.1:8197 and GCLOUD_PROJECT to demo-campus-pulse, then run npm.cmd run test:integration. The suite refuses a real project and clears only the local emulator database between tests. Reseed the local preview afterward with node scripts/seed-emulator.mjs.

tests/spark.test.mjs exercises the exact browser engine through the real Firebase web SDK and enforced combined rules: concurrent 3/4/5-device matching, restoration, unauthorized writes, acceptance, deadlines, live chat, leave/cancel, spot changes, expiry, arrival and existing profile/chat compatibility. Pure tests cover timing, GPS dwell and readiness.

## Deployment

Use the existing Firebase CLI login. No credentials are copied into this folder. All deployment scripts pin the project to hackathon2026-bfbf3.

    node scripts/deploy-spark.mjs
    node scripts/deploy-spark.mjs --apply
    node scripts/sync-app-rules.mjs 'C:\Users\Victor\Desktop\Extra\HackAthon\interactive-map\LiveChat\firestore.rules' --apply
    node scripts/seed-catalog.mjs
    node scripts/seed-catalog.mjs --apply

The deployment script fetches current cloud rules, backs them up, merges the managed Pulse block, checks for concurrent changes, deploys only firestore:rules, and verifies the resulting rules hash. The rule merger replaces its own marked block on later deployments. It refuses unknown/unmanaged Pulse blocks.

Synchronize the canonical app rules so a later ordinary app deployment preserves Pulse. The sync script refuses to overwrite independently changed app rules. The create-only catalog importer never replaces existing records; later spot edits should be deliberate updates to the live catalog.

No indexes, functions, hosting, billing changes or synthetic students are deployed. Current queries use single-field indexes.

## Maintenance

    node scripts/cleanup-spark.mjs

This previews up to 50 expired proposals and 50 expired availability documents. Add --apply to delete those records. Nested messages and check-ins are deleted before their parent. Run again if a batch limit was reached. Proposals become eligible 24 hours after the planned end; tickets become eligible ten minutes after availability ends. Parent deletion is not granted to app clients.

Free usage quotas and project-wide use must be monitored in Firebase. For a public rollout, reassess abuse controls, discovery privacy, queue pagination, moderation, reliable background processing and capacity.
