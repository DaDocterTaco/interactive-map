# Campus Pulse — Firebase Spark demo

Pulse now uses Firebase Authentication and Cloud Firestore directly. It does not deploy Cloud Functions, Cloud Scheduler, or TTL policies and does not require a Blaze upgrade.

The existing interface supports availability, 2–4 person proposals, individual acceptance, private group chat, a destination pin, manual arrival, and optional automatic arrival while the page is visible. Exact starting coordinates and GPS fixes stay on the device. Only activity choices, a time window, a display name and coarse walking estimates enter the matching pool.

## Start here

- [Demo walkthrough and confirmed places](docs/demo-plan.md)
- [Database layout and access rules](docs/data-model.md)
- [Setup, tests and deployment](docs/backend-setup.md)
- [Browser and phone rehearsal](docs/interface-setup.md)

## One feature folder

    Pulse/
      client/     Interface, direct Firestore engine, adapter and arrival watcher
      shared/     Timing, distance and input validation
      backend/    Security Rules fragment and approved demo spot catalog
      scripts/    Rule deployment, catalog import, maintenance, preview and installer
      tests/      Policy, arrival, readiness and real SDK/rules integration tests
      preview/    Explicitly local emulator rehearsal
      docs/       Setup, data model and demo instructions
      firebase.json
      package.json
      package-lock.json

Runtime data stays under pulse/mmc in the existing Firebase project. The catalog contains Café Bustelo in Graham Center, Chick-fil-A in PG5 Market Station, and Kissing Pond benches. Victor confirmed the locations on 2026-09-27; mapped coordinates are not surveyed door positions, and on-site phone rehearsal remains necessary.

The installed campus app reuses its existing Firebase app, sign-in identity and Leaflet map. Pulse is excluded from the application's unrelated-data rules fallback. Combined rules preserve the existing chat, profile and forum policies.

## Spark limits and operational differences

Matching and deadline settlement run while an opted-in app is open; everyone closing the app pauses processing until somebody returns. Server rules still reject late acceptance and expired chat writes. Automatic arrival is self-reported and checks fresh device readings locally; it is not proof of physical attendance.

Expiration blocks further activity. Physical deletion is a separate manual maintenance step with scripts/cleanup-spark.mjs. Its default is a dry-run, and --apply removes only expired MMC Pulse records, including nested messages/check-ins before deleting a proposal. There is no promise of automatic deletion exactly 24 hours later.

The app must be reachable over HTTPS for location access from real phones. Website hosting is separate from the Firebase database deployment. Firestore quotas are shared with the rest of the project.
