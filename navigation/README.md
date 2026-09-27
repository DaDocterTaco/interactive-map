# Navigation

A portable navigation backbone for the FIU campus app. Routing implementation, data, tests, and preview files live in this folder. The main app now connects ClassSearch's **Find this class** action through the optional `classNavigation.js` adapter. Other features can continue using the core independently. See [CLASS-NAVIGATION.md](./CLASS-NAVIGATION.md) for the working class flow and `INSTALLATION.md` for installation details.

**Live navigation is available in `liveNavigation.js`.** It accepts continuous GPS fixes, updates remaining distance/time, confirms arrival, and automatically reroutes after confirmed deviation. It is inert until called. See [LIVE-NAVIGATION.md](./LIVE-NAVIGATION.md) for usage and lifecycle details.

Every feature supplies **two locations and a travel mode**. The module returns **a connected outdoor path, distance, estimated time, path sections, and limitations**. The module has no runtime packages, API keys, framework, database, geolocation permission, or build step. The bundled provider calculates routes locally in the browser; it never sends the locations to a server.

## Try it

```sh
cd navigation
npm run preview
```

Open <http://localhost:8770/>. The independent preview includes a schematic campus map, eight building choices, walking/bike/scooter modes, and fastest/shortest routing. Its map is a local SVG; there are no map tiles, fonts, or CDN dependencies. Use HTTP or HTTPS rather than opening `index.html` as a file. `npm test` runs the Node test suite without installing packages.

## One interface for every section

Copy the whole `navigation/` folder into the app and preserve its layout. Import from the URL appropriate to the host page:

```js
import { createNavigation } from './navigation/index.js';

// Create once in the host's integration module; share this instance across features.
const navigation = createNavigation();

const route = await navigation.getRoute({
  from: { lat: 25.756189, lng: -80.372736 }, // Graham Center building pin
  to:   { lat: 25.7573446, lng: -80.3744413 }, // Green Library building pin
  mode: 'walk', // 'walk' | 'bike' | 'scooter'
});

console.log(route.distanceMeters, route.durationSeconds);
// GeoJSON uses [longitude, latitude]. Input uses named coordinates.
console.log(route.geometry);
```

Use the same call from class search, events, map markers, or any other feature. Locations can be named coordinates, browser GPS positions, GeoJSON Points/Features, Leaflet markers, nested `location`/`building`/`fix` objects, or a `latitude,longitude` string. Campus names/codes resolve against the bundled 90-entry catalog on demand, including `GC`, `GL`, `Graham Center`, and `Green Library`. Configure array order explicitly for coordinate arrays. Unknown address text needs a caller-supplied resolver; it is never guessed. See [LIVE-NAVIGATION.md](./LIVE-NAVIGATION.md#location-inputs).

Use verified outdoor entrances where available. Existing class/event building pins often lie inside a footprint. The route ends on the nearest eligible mapped segment; `endpoints.from/to.offsetMeters` reports the gap. It does **not** draw an invented line through a building or include that unverified gap in distance/time. Show `route.warnings` alongside the estimate.

## Add it to the current Leaflet map

```js
import {
  createNavigation, createLeafletRenderer, createRouteController,
} from './navigation/index.js';

const navigation = createNavigation();
const renderer = createLeafletRenderer({ map, L }); // existing map and Leaflet
const controller = createRouteController({
  navigation,
  renderer,
  onState(state) {
    // Host owns its UI: idle, loading, ready, error.
    if (state.status === 'ready') {
      timeElement.textContent = `${Math.ceil(state.route.durationSeconds / 60)} min`;
      // Also display distance, endpoint gaps, and state.route.warnings.
    }
    if (state.status === 'error') statusElement.textContent = state.error.message;
  },
});

// A class or event Directions handler supplies the start and destination.
try {
  await controller.route({ from: selectedStart, to: selectedDestination, mode: 'walk' });
} catch (error) {
  // onState already receives the error; handle/report it as the host requires.
}

// On dismiss: controller.clear();
// On host teardown: controller.dispose();
```

The renderer adds one owned Leaflet layer group. `clear()` removes its route, `dispose()` removes the group, and neither touches existing markers or overlays. Set `fitBounds: false` if the host owns camera movement. No stylesheet is required by the Leaflet renderer. The demo styles are scoped to its standalone page and should not be imported into the app.

Give each independent display its own controller. Requests within a controller use “latest request wins,” so changing the destination cannot let an older result replace the new one. The navigation service itself has no global UI state and can serve multiple sections concurrently. If the app wants a single active route, it can share one controller intentionally.

For React/Vue, create the service once, call it from existing handlers, and dispose the renderer/controller in the component cleanup. For a 3D map, consume `route.geometry.coordinates` and project the geographic coordinates into the scene; no routing changes are needed.

## Responsibilities

| Part | Owns |
| --- | --- |
| `locationservices/` (existing sibling feature) | User permission, a fresh device position, accuracy, on-campus state |
| Host feature | Origin/destination selection, status UI, map lifecycle |
| `index.js` | Stable API, lazy data loading, bounded in-memory cache, cancellation, optional display controller |
| `locations.js` | Location normalization, campus code/name lookup, optional custom address resolver |
| `liveNavigation.js` | GPS quality/freshness, route progress, rerouting, arrival, journey lifecycle |
| `classNavigation.js`, `classNavigationSession.js` | Optional class popup, route framing, and connection to the app's shared location service |
| `browserLocationSource.js` | Optional explicitly started GPS watch, visibility pause, watch cleanup |
| `graphProvider.js` | Segment snapping, A* search, mode restrictions, time/distance calculation |
| `leafletRenderer.js` | Optional route lines and endpoint markers on an existing Leaflet map |
| `data/campus-graph.json` | Outdoor path topology and per-mode access assumptions |

Importing or constructing navigation does not start a GPS watch. Feed the existing location service's fixes into `live.updatePosition(fix)` to get progress and automatic rerouting. The optional browser source can own a watch when no other location feature does; start it explicitly from a user action. Spoken directions, turn-by-turn maneuvers, background tracking, and traffic feeds are not included. Live ETA uses the declared mode speeds, not learned user speed.

## What “best” means

The default is the minimum estimated travel time **between the snapped points on the supplied graph**, respecting mode/access/direction restrictions and provided closures. `preference: 'shortest'` minimizes length instead. This is not a claim of globally fastest, safest, or fully accessible travel.

The bundled graph contains 4,537 points and 4,976 connected path segments from the existing OSM snapshot. Topology follows source node IDs, so visually crossing bridges/paths do not become artificial intersections. Gaps remain gaps. The provider throws `NO_ROUTE` rather than returning a straight line if the selected segments are disconnected. It does not search for a more distant connected segment just to make a route succeed.

Bike/scooter routes exclude steps. Walking can set `avoidSteps: true`, but that is **not wheelchair routing**: slopes, widths, kerbs, and lifts have not been surveyed. Road carriageways, indoor paths, polygon-only areas, and unsupported conditional-access ways are excluded from the campus extract. This reduces coverage, especially outside the campus core. It does not route off campus.

Default speed assumptions are walking **3 mph (1.34112 m/s)**, biking **15 mph (6.7056 m/s)**, and scooter **15 mph (6.7056 m/s)**. These are configurable product estimates, not measured user speeds or legal speed limits. Steps slow walking; known rough surfaces slow travel. Estimates exclude stops, crossing wait times, weather, crowds, indoor travel, parking/unlocking a device, and unverified endpoint access.

Riding permission is absent on many source paths. By default, bike/scooter travel uses walking speed and a `dismount` section where riding access is unknown. Set `allowUnverifiedRiding: true` to show **provisional riding estimates**; the app's shared class/Explore route session uses this option for bike and scooter modes, in both manual planning and live GPS estimates. Warnings remain visible and explicit prohibitions and dismount sections remain in force. Scooter permission is independent of bicycle permission. The module does not establish current campus riding rules. Auditing path permissions and entrances is the next data step before presenting reliable public directions.

## Request options and result

```js
await navigation.getRoute({
  from, to,
  mode: 'bike',
  preference: 'fastest',
  avoidSteps: true,
  allowUnverifiedRiding: false,
  maxSnapMeters: 60, // 0–250; default 60; reject distant points
  speeds: { walk: 1.34112, bike: 6.7056, scooter: 6.7056 }, // metres/sec, >0 through 15
  blockedLinkIds: ['42', '43'], // caller-supplied, validated closures
}, { signal: abortController.signal });
```

Results include `geometry` (GeoJSON LineString), `distanceMeters`, `durationSeconds`, `mode`, `preference`, `endpoints` (requested/snapped/offset), `steps`, `linkIds`, `warnings`, `metadata`, and `estimate: true`. Steps are grouped path sections, not turn-by-turn maneuvers. `linkIds` are array indexes in this graph version; regenerate closure mappings when the graph changes. The source hash is recorded in metadata.

Errors have stable `.code` values: `INVALID_LOCATION`, `INVALID_MODE`, `INVALID_OPTIONS`, `OUTSIDE_NETWORK`, `NO_ROUTE`, `INVALID_GRAPH`, `DATA_UNAVAILABLE`, `ABORTED`, and `DISPOSED`. Failed data loads can be retried. Cancellation rejects promptly at the service level; it does not interrupt synchronous CPU work mid-search or cancel another caller's shared data download. The campus search is small enough to stay on the main thread; use a Web Worker/provider for substantially larger graphs.

The default cache keeps the latest 32 successful requests in memory, including all supplied options and exact coordinates. It stores no location history on disk. Use `cacheSize: 0` for a live external provider, or call `navigation.clearCache()` whenever its data changes. A changing `blockedLinkIds` list naturally uses a different cache entry. Release the service instance when its host is destroyed to release cached locations.

## Swap the routing provider without rewriting callers

```js
const navigation = createNavigation({
  cacheSize: 0,
  provider: {
    async getRoute(request, { signal } = {}) {
      // Call your backend or another local graph here and normalize to Route.
      // Keep private routing credentials on the backend.
      return yourRoutingAdapter(request, { signal });
    },
  },
});
```

Providers implement `getRoute(request, {signal})` and return the documented `Route`. TypeScript declarations live in `index.d.ts`. An external provider can later add broader coverage or live restrictions; if it transmits user coordinates, the host must reflect that changed behavior in its location UX.

The local graph schema is deliberately small:

```js
{
  schemaVersion: 1,
  metadata: { id: 'your-campus-v1' },
  nodes: [[25, -80], [25, -79.999]], // [latitude, longitude]
  links: [[0, 1, 0]],              // [fromNode, toNode, profileIndex]
  profiles: [{
    kind: 'footway', name: 'Main path',
    access: { walk: 'travel', bike: 'travel', scooter: 'unverified' },
    direction: { walk: 0, bike: 0, scooter: 0 }, // 0 both, 1 forward, -1 reverse
  }],
}
```

Pass this object to `createGraphProvider(graph)`. Access is `travel`, `dismount`, `unverified`, or `no`; walking only supports `travel`/`no`. Dismounting uses pedestrian direction and speed and requires walking access. `kind: 'steps'` excludes bikes/scooters regardless of access. `rough: true` applies a 0.7 speed factor. Coordinate order in the compact graph is lat/lng; public GeoJSON output uses lng/lat.

## Data and validation

`npm run build:data` rebuilds only this folder's assets from `../fiu-model/data/`. That sibling is needed only for rebuilding, never at runtime. The graph records the input SHA-256. Its input has no reliable source timestamp, so `builtAt` is **not** a data-freshness claim. Data is a snapshot with no live closures feed. The demo building pins came from the project's cached official FIU directory (retrieved 2026-09-25), not verified entrances.

The tests cover segment snapping, route costs, one-way paths, mode restrictions, dismounts, closures, disconnected/overpassing paths, invalid inputs, cancellation, caching, failed loads, display lifecycle, GeoJSON/Leaflet coordinate conversion, and 192 bundled-campus building/mode combinations. Passing those checks verifies software behavior and sampled connectivity; it does not constitute a field survey.

The runtime JS and the graph are small static files; enable HTTP compression when deploying. The default provider fetches the graph only on first use. The standalone demo loads it immediately to draw the entire path network. No other app files, shared package files, or feature handlers were changed.

Map/path data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under ODbL 1.0. Keep that attribution visible wherever these routes are displayed. The derived graph and demo context are supplied in editable JSON. See [DATA-SOURCES.md](./DATA-SOURCES.md) for provenance and access interpretation references.
