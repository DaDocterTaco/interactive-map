# FIU interactive campus map

Open `index.html` through a local HTTP server. The page uses Leaflet for the
campus map and loads Firebase browser modules directly, without a JavaScript
build step. Opening it with `file://` prevents the chat and class data fetches
from working.

## Where to find things

- `index.html` creates the map and mounts the feature modules.
- `Locations.JS` contains the base building coordinates and joins events to
  building popups. `get_events.py` refreshes the checked-in `events.json` from
  Panther Connect's RSS feed.
- `ClassSearch/` contains the local class snapshot, search logic, dialog, and
  dedicated class pin. See `ClassSearch/README.md` for data limits and refresh
  steps.
- `LiveChat/` contains Firebase sign-in, chats, groups, people, forums, and
  verified map warnings. See `LiveChat/README.md` for data paths and checks.
- `firebase.js` initializes the browser Firebase app. `firebase.chat.json`
  points the Firebase CLI and emulator to `LiveChat/firestore.rules`.
- `LiveChat/starter-preview/` is a standalone UI sample with local data. It is
  separate from the live Firebase chat.

JSON files are data or tool configuration: `events.json` and
`ClassSearch/classes.json` are snapshots; `package.json`, `package-lock.json`,
and `firebase.chat.json` are consumed by tooling. They cannot contain code
comments, so their purposes are documented here and in the feature READMEs.
