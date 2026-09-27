# Campus Pulse

This folder contains Pulse's interface, Firebase backend, shared matching rules, tests, and rehearsal instructions.

**Current status:** interface and backend implemented and tested locally, with a small integration into the campus map. Availability, shared proposals, confirmation, participant-only chat, map pins, manual/automatic arrival, expiry, and cleanup are implemented. The Firebase deployment, verified real spot catalog, HTTPS hosting, and three-phone field rehearsal remain pending. No production Firebase data has been created or changed.

- [Demo scope, selected meeting spots, and acceptance checks](docs/demo-plan.md)
- [Database layout, ownership, permissions, and cleanup](docs/data-model.md)
- [Local setup, API, validation results, and deployment handoff](docs/backend-setup.md)
- [Browser rehearsal and app integration](docs/interface-setup.md)

## Feature layout

```text
Pulse/
  README.md
  docs/
    demo-plan.md
    data-model.md
  client/        # Responsive Pulse dialog, Firebase adapter, arrival watcher, app mount
  backend/       # Trusted matching, acceptance, lifecycle, and check-in functions
  shared/        # Activity IDs, validation, timing and distance calculations
  tests/         # Matching, concurrency, permissions, and arrival tests
  scripts/       # Emulator seed, local preview, app integration and rule merger
  preview/       # Local-only rehearsal; separate from the production entrypoint
  firebase.json
  package.json
  package-lock.json
```

The catalog in `backend/spots.draft.json` is intentionally disabled pending location verification. Automated tests use an explicitly synthetic emulator-only spot, never pretend campus participants or unverified production pins.

The app integration reuses the existing Firebase instance, chat identity, and Leaflet map. Pulse's small participant chat renderer lives in its dialog; ordinary campus chat keeps its own renderer and data. Entry-point edits load the feature and permit only `Pulse/client` and `Pulse/shared` browser assets through the app's local server.

The production Firestore rules must be merged into the app's one deployed ruleset. A separate Pulse rule file would not automatically apply or override the current open fallback. Tests should exercise the combined ruleset. Browser hosting must publish only client assets and intentionally shared browser modules; backend code, test fixtures, local configuration, and credentials must be excluded from the hosting output.

## Storage approach

Keep Pulse's runtime records in Cloud Firestore under `pulse/{campusId}`. Start with `pulse/mmc`. This parent document stores campus metadata, not growing arrays of students, messages, or meetups. Subcollections provide the expandable hierarchy.

Reuse existing Firebase Authentication accounts and `users/{uid}` profiles. Pulse refers to user IDs and does not create another account system. Pulse meetup messages belong to their meetup and appear inside the Pulse dialog, with no duplicate copy in the ordinary chats collection.

The deployed spot catalog is the runtime source for matching and destination pins. Initial import data can be versioned with code, but must not become a second independently edited live catalog. Add new spots as documents; additional campuses receive their own campus document and corresponding subcollections.
