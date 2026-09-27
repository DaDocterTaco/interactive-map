# Installation and app connection

Requested target: `C:\Users\Victor\Desktop\Extra\HackAthon\interactive-map\navigation`.

The navigation engine stays in `navigation/`. The app root `index.html` now constructs its optional class adapter and passes it to `mountClassSearch`. ClassSearch invokes it from **Find this class**. The existing Leaflet location service adds subscription and camera-follow controls so navigation can share one GPS watch. Shared package files and unrelated features are unchanged.

Importing `navigation/index.js` exposes the APIs without starting a journey or GPS watch. The independent demo remains reachable at `/navigation/`. The class flow is available from the main app's class finder. See [CLASS-NAVIGATION.md](./CLASS-NAVIGATION.md).

Runtime entry: `index.js`. Live controller: `liveNavigation.js`. Usage: `LIVE-NAVIGATION.md`. Tests: `npm test` inside this folder; no dependency installation required.

The initial engine development copy is `C:\Users\Victor\Documents\ChatGPT\Hackathon\navigation`; the class integration was staged in `class-route-work` in the same workspace. Treat the installed project copy as the implementation to commit. Update deliberately rather than editing copies independently.

`install.ps1 -Target <project-root>` performs a first-time folder copy only. It refuses to overwrite an existing navigation folder and does not wire up the host. Core runtime assets are self-contained; the optional class adapter expects the app's ClassSearch, Leaflet, and location service. Rebuilding OSM-derived data needs the source data directory, which can be supplied explicitly:

```powershell
node tools/build-campus.mjs 'C:\Users\Victor\Documents\ChatGPT\Hackathon\fiu-model\data'
```

Without that argument the builder expects a sibling `fiu-model/data/` directory. Building data is not required to use this installed module.
