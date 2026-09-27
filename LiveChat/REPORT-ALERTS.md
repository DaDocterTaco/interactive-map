# Reports and alerts

The refined report view keeps the existing Chats/Forums frame. On desktop, verified alerts include a location preview. At 900px and below, report details use one column and a View on map action, with no map beside the content. The location picker remains inside the submission form.

## State and permissions

- Only saved, verified, current reports with valid coordinates receive campus map markers.
- Under review and Needs details remain off the map. A reviewer can request a clarification; the author can respond once, returning the report to review.
- Authorized verifiers cannot review their own report. Rejection and withdrawal require an explanation, with actor and server timestamp. Existing approval history remains immutable.
- Authors and verifiers can resolve open reports. Resolved, rejected and expired reports remain accessible as history, with discussion preserved.
- Pending reports expire after 24 hours from submission. Verification starts a 24-hour display window. Replies and observations do not extend it. Expired or corrected reports need a new submission in this version.
- An observation represents one account and is separate from reviewer verification. It can be withdrawn while the report is open.
- Stable submission IDs protect against duplicates when retrying a failed send. Draft fields persist across dialog reopening. The Firestore rules enforce permissions and allowed field changes independently of UI controls.

No roles are granted from the interface. Existing sign-in requirements remain. Test fixtures are stored only in the separate local QA directory and are not part of this application.

## Validation

Run `firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/run-forum-integration.cjs"` from the repository root. The runner includes forum, reply/bookmark, observation, verification, lifecycle, review, and map-listener integration suites.

Controller regression tests: `forum-ui.test.cjs`, `alert-ui.test.cjs`, `map-warnings-ui.test.cjs`, `report-clock.test.cjs`, `forum-model.test.cjs`, and `forum-link-loader.test.cjs` in `LiveChat/tests`.

Apply `LiveChat/firestore.rules` to the existing Firebase project when updating the client. New decision fields require these rules.
