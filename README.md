# Campus Loop

**Your campus, connected.** Campus Loop brings campus maps, class locations, events, student conversations, and spontaneous meetups into one web app for Florida International University's Modesto A. Maidique Campus (MMC).

Explore campus in 2D or 3D, find your next class, plan an outdoor route, see what's happening, and connect with other students without leaving the map.

## What's included

| Feature | What you can do |
| --- | --- |
| **Campus map** | Switch between a Leaflet 2D map and a Three.js 3D campus model, explore buildings, and use map camera controls. |
| **Class finder** | Search course codes, titles, or numeric class IDs; filter sections; inspect meeting details; and find the class building on the map. |
| **Outdoor navigation** | Plan walking, bike, or scooter routes from a chosen campus start or device location, with distance, estimated time, and live route progress. |
| **Events** | Search and filter published FIU Calendar and Panther Connect listings by date, campus, category, food, and admission; map events with a supported location. |
| **Community** | Join Campus Chat, create public or private groups, find people, save friends, send direct messages, and customize your profile. |
| **Forums and alerts** | Start discussions, reply, report campus concerns, and view approved active warning markers on the map. |
| **Campus Pulse** | Share availability, receive a small-group meetup proposal, accept a plan, chat with participants, and check in at the meeting spot. |
| **AI assistant** | Ask campus questions through an optional Python/Gemini backend using the bundled building, event, and alert data. |

The interface supports desktop and mobile layouts, light and dark themes, and reduced-motion preferences. The 3D view uses approximate building heights and falls back to the 2D map if it cannot load.

## Quick start

Run these commands from the repository root, the folder containing `index.html`:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open [Campus Loop locally](http://127.0.0.1:8000/). On systems where Python is named `python3`, use `python3` instead.

There is **no frontend build step**. Do not open `index.html` with `file://`: the app loads modules, templates, catalogs, and map assets over HTTP. An internet connection is needed for external JavaScript modules, map tiles, and Firebase features.

The map and bundled catalogs do not require the Python assistant. Community, alerts, and Pulse require Firebase configuration and access to their backend data. The checked-in browser configuration connects to the existing project, so normal community actions can affect shared data; use the emulator instructions below for tests.

To start directly in 2D, open [the 2D view](http://127.0.0.1:8000/?campusView=2d).

### Development prerequisites

- **Python 3** for the static server and optional assistant.
- **Node.js 22 or newer** and npm for Node tests and Firebase tooling.
- **A modern browser**; WebGL is needed for 3D rendering.
- **Firebase CLI and a compatible Java runtime** when running Firestore emulator tests.

Install the root Node dependencies when working on Firebase tools or integration tests:

```sh
npm ci
```

On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`. The root package has no `start`, `build`, or `test` npm script; use the commands documented here.

## Optional AI assistant

Create a virtual environment and install the packages imported by `campus_ai.py`:

```sh
python -m venv .venv
```

Activate it with `.venv\Scripts\Activate.ps1` in PowerShell or `source .venv/bin/activate` in macOS/Linux shells, then run:

```sh
python -m pip install flask flask-cors google-genai python-dotenv
```

Copy `.env.example` to `.env` and replace its placeholder:

```dotenv
GEMINI_API_KEY=your_gemini_api_key_here
```

Keep the static server running and start the assistant in another terminal from the repository root:

```sh
python campus_ai.py
```

For a page opened on `localhost` or `127.0.0.1`, `app.js` sends requests to `http://127.0.0.1:5000/chat`. Elsewhere, it defaults to `/api/chat`. A host can set `window.CAMPUS_ASSISTANT_URL` before `app.js` loads to supply a different endpoint. Static hosting alone does not provide this API.

The backend currently requests `gemini-3.5-flash-lite`; model access and quota depend on the configured Gemini project. The Python server runs in Flask debug mode for local development. A public deployment needs a separately configured backend.

**Current data limitations:** the assistant reads its JSON files once at startup, so restart it after updating data. It reads the legacy root `events.json`, while the Events panel reads `Events/data/events.current.json`. On case-sensitive filesystems, its `buildings.json` lookup does not match the tracked `Buildings.json`; align that filename in `campus_ai.py` to load building context. General FIU answers can also use model knowledge and are not a live information feed.

## Firebase and community setup

The browser uses Firebase Authentication and Cloud Firestore through the CDN imports in `firebase.js`. Its checked-in project ID is `hackathon2026-bfbf3`.

For a separate installation:

1. Register a Firebase web app and update the browser configuration in `firebase.js`.
2. Enable Anonymous Authentication and create a Firestore database.
3. Review the combined rules in `LiveChat/firestore.rules`, including the Pulse rules, and configure your target project deliberately.
4. Follow the [Pulse backend setup](Pulse/docs/backend-setup.md) to prepare meetup places and matching data. Its administrative scripts contain project-specific targets; review them before using a different project.

Opening community chat prompts for a display name and creates or restores a browser-specific anonymous identity. Reusing a name on another browser or origin does not restore the same account, friends, memberships, or direct messages.

Moderator and verifier access are independent roles assigned by a trusted administrator using the exact Firebase UID:

- `users/{uid}/roles/moderator`, with `enabled: true`, grants supported chat moderation actions.
- `users/{uid}/roles/verifier`, with `enabled: true`, grants warning-review actions.

Clients cannot grant themselves these roles. See the [community documentation](LiveChat/README.md) for conversation access, membership, moderation, and data paths.

**Rules deployment requires review:** the checked-in rules retain a permissive policy for unrelated collections until October 25, 2026. They are not a production security baseline for arbitrary additional collections. Preserve any deployment-specific protections when merging rules, and verify the target project before deploying.

### Warning lifecycle

New reports enter review. Community confirmations do not automatically approve them. Only approved, active reports with valid locations appear on the map.

Pending reports expire 24 hours after creation. Approval starts a new 24-hour display window. Reviewers can request details or reject reports; resolution or expiry removes an active map warning while preserving its forum history. The current lifecycle is implemented in `LiveChat/forums/reportLifecycle.js` and enforced by `LiveChat/firestore.rules`.

### Pulse meetups

Pulse supports availability, proposals for 2–4 people, individual acceptance, private meetup chat, a destination pin, and manual or optional automatic arrival. Its matching workflow uses Firebase directly and does not require Cloud Functions or scheduled jobs.

Exact starting coordinates and GPS fixes stay on the device; activity choices, availability, display names, and coarse walking estimates enter the matching pool. Automatic arrival runs while the page is visible. Read the [Pulse overview](Pulse/README.md) and [demo walkthrough](Pulse/docs/demo-plan.md) for the complete flow.

## Location, routing, and phone previews

Use **Locate me** and grant browser permission to enable location features. Location display is limited to the campus boundary. You can also plan routes with a manually selected campus start.

Routes use a bundled OpenStreetMap-derived outdoor graph and are calculated in the browser. Estimates support walking, biking, and scooters, including live progress and rerouting. They do not include indoor directions, spoken turn-by-turn instructions, live traffic, or guaranteed accessible paths. Building pins are not verified entrances; endpoint gaps and route warnings matter. See [navigation documentation](navigation/README.md) for mode assumptions and coverage.

For location access on a phone, use a trusted **HTTPS** deployment or preview. An ordinary HTTP LAN address does not provide the secure context required for phone geolocation.

The repository includes an allowlisted LAN server:

```sh
python tools/serve_lan.py --port 8080
```

Open `http://<computer-IPv4-address>:8080/` from a device on the same network. On Windows, use `ipconfig` to find the address. The computer must stay awake, the firewall must allow the connection, and the network must allow device-to-device traffic.

**Current LAN limitation:** this server's allowlist omits newer files, including `CampusUI/mobileInput.css`, so it can return 404s for current UI assets. Bring the allowlist up to date before relying on it for a complete phone demo. The unrestricted Python server in Quick start is bound to loopback for local development.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html`, `app.css`, `app.js` | App entry point, shared styling, feature wiring, and assistant UI. |
| `Splash/` | Campus Loop welcome screen and loading presentation. |
| `CampusUI/`, `ActionBar/` | App shell, campus exploration, camera behavior, and shared controls. |
| `Campus3D/` | Three.js scene, campus model, projection, and map interaction. |
| `ClassSearch/` | Class catalog, search UI, building outlines, and tests. |
| `navigation/` | Outdoor route graph, routing engine, live progress, and class integration. |
| `locationservices/` | Campus boundary, GPS tracking, heading, and Leaflet location display. |
| `Events/` | Event browsing, filters, and the current event snapshot. |
| `LiveChat/` | Chat, groups, profiles, people, forums, warnings, and combined Firestore rules. |
| `Pulse/` | Meetup interface, matching engine, arrival logic, scripts, and documentation. |
| `firebase.js`, `firebase.chat.json` | Browser Firebase configuration and chat emulator/rules configuration. |
| `campus_ai.py`, `.env.example` | Optional Flask/Gemini assistant and its configuration template. |
| `Buildings.json`, `events.json`, `forum_alerts.json` | Root data snapshots used by map or assistant tooling. |
| `get_events.py`, `AlertNode.js` | Legacy event refresh and administrative alert export utilities. |
| `tools/`, `vendor/` | Local serving tools and bundled browser dependencies. |

## Data maintenance

- **Classes:** `ClassSearch/classes.json` is a Fall 2026 MMC snapshot, not live enrollment data. Pins identify buildings rather than interior rooms. See [class finder documentation](ClassSearch/README.md).
- **Events:** `Events/data/events.current.json` contains manually refreshed listings and source-health metadata. Listings may be incomplete or change; use each event's official source link for current details. Running `get_events.py` updates only the legacy root `events.json` and requires the Python `requests` package.
- **Routes and 3D:** campus geometry and routes are snapshots. Approximate heights, unsurveyed entrances, and incomplete access information limit their accuracy. See [navigation data sources](navigation/DATA-SOURCES.md).
- **Assistant alerts:** `node AlertNode.js` exports forum documents with `category == "Alert"` to `forum_alerts.json`. It requires root npm dependencies and a local `service-account.json` based on the example file. The exporter does not filter for approval, resolution, or expiry, so its output is not equivalent to the active map warnings.

Run data utilities from the repository root. `.env` and `service-account.json` are ignored by Git; keep them out of published browser assets. Updating a snapshot does not automatically deploy it or refresh an already-running assistant.

## Checks and tests

Run these local checks from the repository root:

```sh
node --test ClassSearch/classData.test.mjs ClassSearch/classMotion.test.mjs
npm --prefix navigation test
npm --prefix Pulse test
node --test CampusUI/camera.test.mjs Campus3D/mapGestures.test.mjs
node LiveChat/tests/chat-ui.test.cjs
node LiveChat/tests/forum-ui.test.cjs
python -m unittest discover -s tools -p "test_*.py"
```

These are useful starting checks, not the full integration suite. Chat/Firestore integration tests require the emulator. After installing the root npm dependencies, run, for example:

```sh
firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/firestore.test.mjs"
```

Use the additional commands in [LiveChat/README.md](LiveChat/README.md) for groups, forums, alerts, and moderation. For Pulse's separate Auth/Firestore emulator setup, follow [Pulse/docs/backend-setup.md](Pulse/docs/backend-setup.md). Do not run every test file indiscriminately: several suites require emulator configuration and isolated data.

Before a demo, check the map in both views, class search and route selection, event details, community sign-in, and Pulse on desktop and mobile. Test real device GPS separately from simulated location tests.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Blank UI or catalogs fail to load | Serve the repository root over HTTP; check the browser console and network requests for missing assets or blocked CDN modules. |
| 3D fails to load | Use the 2D selector or `?campusView=2d`; check WebGL support and the model/CDN requests. |
| Chat or Pulse reports permission errors | Check Anonymous Authentication, the active Firebase project, deployed rules, and the Pulse catalog setup. |
| Location is unavailable | Check browser permission, HTTPS on phones, GPS quality, and whether the position is within the campus boundary. |
| No route is found | Try a start/destination on the mapped campus network; disconnected paths and coverage gaps can prevent a route. |
| Assistant is unavailable | Start `campus_ai.py`, configure `GEMINI_API_KEY`, and confirm the endpoint selected by `app.js`. A static phone preview has no `/api/chat` backend by default. |
| Assistant misses buildings on Linux/macOS | Align the `buildings.json` lookup in `campus_ai.py` with the tracked `Buildings.json` filename. |
| Phone preview is missing styling | Check the LAN server allowlist against the browser's failed asset requests. |

## Hosting and attribution

The frontend can be served as static assets with its directory structure preserved. Publish browser assets only; exclude credentials, administrative scripts, tests, dependency folders, and debug logs. Use HTTPS for deployed location features and provide a backend for `/api/chat` if the assistant is enabled. This source tree does not include a complete Firebase Hosting/assistant deployment configuration.

Map and path data are © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under ODbL. Keep the map attribution visible. The app uses Leaflet, Three.js, Firebase, and bundled third-party assets; preserve their accompanying license and attribution files. See the [class assets documentation](ClassSearch/README.md), [chat assets documentation](LiveChat/assets/README.md), and [Pulse icon credits](Pulse/client/icons/README.md).
