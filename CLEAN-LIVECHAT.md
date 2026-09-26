# Clean livechat branch

This branch starts at `RSS_Feed` commit `3e64f01f1260a8f6d8f2ba0d197f587a541b0a73` and adds the saved chat, class search, and verified map warnings.

## Preserved features

- `LiveChat/`: the latest chat and forum UI, saved identity, groups, private access, direct conversations, people/friends, moderation, alert reports, verification, expiry, and warning markers. Includes the previously uncommitted UI improvements and icon assets.
- `ClassSearch/`: the existing Fall 2026 MMC dataset, class search, room information, and independent locate-class marker.
- `firebase.js`, `firebase.chat.json`, and npm dependencies: the existing chat connection, rules configuration, and test dependencies.
- `index.html`: loads the original Leaflet map and building/event markers, plus Open chat, Open Class, and the independent warning layer. The version suffix on Locations.JS prevents a cached copy of the previous event loader from being reused.

## Original RSS behavior

`Locations.JS`, `get_events.py`, and `events.json` are unchanged from the RSS base commit. That implementation reads Panther Connect and displays events inside building popups. The checked-in event snapshot is historical; its original importer can be run from the project root to refresh it:

```sh
python -m pip install requests
python get_events.py
```

The added Events dialog, combined FIU Calendar importer, newer event modules, separate buildings data file, and Campus3D overlay are excluded from this branch. They remain in the backup. The main README is also unchanged from RSS_Feed. Older notes within LiveChat describe the earlier UI work; this document defines the scope of this branch.

## Run and verify

Serve this directory over HTTP, for example `python -m http.server 8000`, and open `http://localhost:8000/index.html`. The existing Firebase configuration is retained; creating this branch does not deploy rules or modify live messages, accounts, or reports.

Local feature checks:

```sh
node --test ClassSearch/classData.test.mjs LiveChat/tests/*.test.cjs
```

The service and rules tests require the Firestore emulator. Run each suite with a fresh emulator because they share a demo database, for example:

```sh
firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/map-warnings.test.mjs"
```

## Restore the full saved project

The complete pre-cleanup source, including previously uncommitted files, is saved on `codex/backup-livechat-20260926`, commit `ac9e81f1ff69b9f7b4ef58fe8d46dcc77c3b482d`. The existing `livechat` branch was not moved. Save any subsequent edits before switching:

```sh
git switch codex/backup-livechat-20260926
```

A verified portable Git bundle is also saved outside the application at `C:/Users/Victor/Documents/ChatGPT/Hackathon/clean-livechat-work/livechat-backup-20260926.bundle`. Generated dependency folders and debug logs remain local and are not source commits.

## Validation on September 26, 2026

- All 23 local class-data, chat-UI, group-UI, people-UI, forum-UI, warning-rendering, and report-clock checks passed.
- Eight emulator suites passed: alerts, chat service, forums, groups, moderation, people, report lifecycle, and verification.
- The existing `map-warnings.test.mjs` passes its initial query, approval addition, coordinates, and confirmation-update checks, then times out waiting for removal after the test uses an administrative REST request to remove approval. A diagnostic also confirmed the field was absent in the emulator document while the listener failed to deliver removal. That integration check remains unresolved; application and test files were preserved from the backup without changes.
- Browser verification on localhost:8000: original RSS building markers render; the Graham Center popup displays event links and times; COT 3100 / class 84848 returns its assigned INV1 room 302; Locate class adds its independent marker while retaining building markers; Open chat displays the saved chat entry flow. No console errors were observed. No test messages or reports were submitted to the live database.
- Git comparisons confirm the original RSS event files and README match the base commit, while LiveChat, ClassSearch, Firebase files, and npm manifests match the complete backup.
