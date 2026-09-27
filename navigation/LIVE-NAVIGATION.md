# Live navigation

The core is installed in a separate `navigation/` folder and has **no automatic initialization**. The app explicitly connects ClassSearch through `classNavigation.js`; clicking **Find this class** starts that journey. Chat and events do not start navigation. See [CLASS-NAVIGATION.md](./CLASS-NAVIGATION.md).

## Use the existing live location feed

```js
import { createNavigation, createLiveNavigation } from './navigation/index.js';

// Disable the route cache for a live-only instance; each GPS origin is usually new.
const navigation = createNavigation({ cacheSize: 0 });
const live = createLiveNavigation({
  navigation,
  onState(state) {
    // Host decides how to display loading, position, route, error, and arrival.
    if (state.progress) {
      console.log(state.progress.remainingDistanceMeters);
      console.log(state.progress.remainingDurationSeconds);
    }
  },
});

// Called by a future Directions action. This does not request GPS permission.
await live.start({ to: 'Green Library', mode: 'walk' });

// Feed each fresh reading from the app's location service:
live.updatePosition(browserGeolocationPosition);
// Or: live.updatePosition({ latitude, longitude, accuracy, timestamp });

// Stop navigation on cancel; dispose it when the owning feature is destroyed.
// live.stop();
// live.dispose();
```

For the existing `locationTracker.js` API, forward updates from its `onChange` callback:

```js
function forwardLocationState(state) {
  if (state.markerVisible && state.fix) live.updatePosition(state.fix);
  else live.invalidateLocation(state.status); // includes paused, outside, denied, stale
}
```

The mounted Leaflet location service now exposes `subscribe(forwardLocationState)`, returning an unsubscribe function. It also exposes `getState()`, `setFollowing(boolean)` and `getFollowing()`. Class navigation uses these APIs to share the existing watch and temporarily own route framing. Subscription callbacks receive copied snapshots; they do not emit an initial value, so read `getState()` when subscribing. Do not create a second watch beside the existing service. The live controller applies its own stricter accuracy/freshness thresholds even when a source calls a reading usable.

## Optional browser GPS source

If a host has no existing GPS owner, it can explicitly start the included source:

```js
import { createBrowserLocationSource } from './navigation/index.js';
const gps = createBrowserLocationSource({ live }); // inert

async function onStartNavigationClick() {
  await live.start({ to: 'GL', mode: 'bike' });
  gps.start(); // browser permission may be requested here, after the user's action
}

function onStopNavigationClick() {
  gps.stop();
  live.stop();
}

function onFeatureUnmount() {
  gps.dispose();
  live.dispose();
}
```

The source owns at most one watch, handles watch ID `0`, ignores callbacks from stopped watches, stops when the journey ends, and releases its watch on `pagehide` or when the document becomes hidden. It does not resume automatically; call `gps.start()` again from a user action. Temporary timeouts/unavailability can recover on a later fix; permission denial ends the watch. The live controller retains the planned path while waiting for GPS, but clears its live progress/ETA and current-position marker.

Browser geolocation requires a secure context and user permission. Phone testing generally needs HTTPS. The browser supplies the GPS/network-derived fixes; background execution is not guaranteed. See [MDN watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition) and [GeolocationPosition](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationPosition). No real device location was used by the automated tests.

## Show it on an existing map later

```js
import { createLeafletRenderer, createLiveNavigation } from './navigation/index.js';

const renderer = createLeafletRenderer({ map, L, fitBounds: false });
const live = createLiveNavigation({ navigation, renderer, onState: updateYourUI });
```

The renderer can display a route plus a current-position marker and accuracy circle. It updates the marker for accepted fixes. `fitBounds: false` leaves the camera entirely to the host. The renderer does not automatically follow the user, rotate the map, trim the travelled polyline, or add a Waze-style screen. A future UI can do those things using `state.position` and `state.progress`. In a 3D view, implement the same optional `show`, `clear`, `updatePosition`, `clearPosition`, and `dispose` methods instead.

## Location inputs

`navigation.getRoute({from,to})`, `navigation.resolveLocation(value)`, and live journey endpoints accept:

| Input | Example |
| --- | --- |
| Named coordinates | `{lat:25.756189,lng:-80.372736}` |
| GPS-style coordinates | `{latitude:25.756189,longitude:-80.372736}` |
| Browser GPS position | `{coords:{latitude,longitude,accuracy},timestamp}` |
| Leaflet marker | An object exposing `getLatLng()` |
| GeoJSON Point/Feature | `{type:'Point',coordinates:[-80.372736,25.756189]}` |
| Existing feature object | `{building:{latitude,longitude}}`, `{location:{lat,lng}}`, `{fix:...}`, `{position:...}` |
| Coordinate string | `'25.756189, -80.372736'` (latitude first) |
| Campus code/name | `'GC'`, `'GL'`, `'Graham Center'`, `'Green Library'` |

The 90-entry campus catalog loads only when a name is used. Matching is exact after case/whitespace normalization, with declared aliases; ambiguous names fail with `AMBIGUOUS_LOCATION`. A catalog match does not guarantee the routing graph covers that place. Coordinates outside the graph still fail with `OUTSIDE_NETWORK` or `NO_ROUTE`.

Bare arrays are intentionally ambiguous unless the host sets an order:

```js
import { createCampusLocationResolver } from './navigation/index.js';
const navigation = createNavigation({
  resolveLocation: createCampusLocationResolver({ arrayOrder: 'latlng' }),
});
// Input arrays now use [latitude, longitude]. GeoJSON always remains [longitude, latitude].
```

An arbitrary address needs a geocoder; an arbitrary app object needs an adapter. The module provides the extension points without choosing a paid service or sending locations anywhere by default:

```js
const navigation = createNavigation({
  resolveLocation: createCampusLocationResolver({
    resolveText: async (query, { signal }) => {
      // Implement your server-backed address lookup and return {lat,lng}.
      return yourAddressLookup(query, { signal });
    },
  }),
});
```

For a custom object schema, supply your own `resolveLocation(input,{signal})` to `createNavigation`. It must return named numeric `{lat,lng}` coordinates. Use `normalizeLocation` for the formats already supported. Unknown text has code `UNRESOLVED_LOCATION`, unsupported formats have `INVALID_LOCATION`, and failed catalog loading has `DATA_UNAVAILABLE`. Raw coordinate objects intentionally require numbers, not numeric strings.

**Continuous updates are stricter than planned endpoints:** `updatePosition` requires a real timestamp in milliseconds and accuracy in metres. A static map pin can be used as `from` in `start`, but cannot masquerade as a live fix. Starting with just `to` waits for GPS. Starting with a static `from` produces a planned route and waits for GPS before reporting live progress.

## Live behavior

- Route progress is measured against the existing polyline on each good fix. It does not fetch/recalculate on every update. Remaining time accounts for the ordered section speeds, including dismount sections; providers without section data use the route's average speed.
- Bad, stale, duplicate, and out-of-order fixes do not advance progress. Weak/stale readings clear live ETA and the current-position marker. Timestamps over one second into the future are rejected.
- By default, two fresh fixes more than `max(20 m, 1.5 × reported accuracy)` away trigger a new route from the latest accepted position. Searches are throttled to at least five seconds apart. Returning to the path cancels a queued reroute.
- Matching uses previous progress and a maximum plausible movement window to reduce jumps at route crossings. It is a lightweight matcher; dense overlapping paths and uncertain GPS can still require rerouting.
- Arrival requires two fresh readings within 15 m of the **requested destination**, with reported accuracy no worse than 15 m, and no more than 15 m remaining on the mapped route. It means proximity to the pin, not a verified doorway or room. Reaching a snapped path endpoint far from a building pin does not mark arrival.
- Late route/geocoder responses cannot replace a newer journey or revive a stopped one. A failed route clears its display and exposes an error; later good fixes can retry with the same throttle.
- `live.refresh({mode:'scooter'})` or `live.refresh({blockedLinkIds:[...]})` immediately recalculates using the latest fresh fix. It does not load a live closures feed. Call `start` to change the destination.

All settings are optional:

```js
createLiveNavigation({
  navigation,
  settings: {
    staleAfterMs: 15000,
    maxAccuracyMeters: 40,
    offRouteMeters: 20,
    offRouteConfirmations: 2,
    rerouteIntervalMs: 5000,
    arrivalMeters: 15,
    arrivalAccuracyMeters: 15,
    arrivalConfirmations: 2,
    maxProgressSpeedMps: 15, // matching plausibility, not the ETA travel speed
  },
});
```

`getState()` returns an independent snapshot. `subscribe(listener)` returns an unsubscribe function. State includes `status`, `active`, `locationStatus`, `destination`, `position`, `route`, `progress`, `offRoute`, `error`, and `rerouteCount`. Progress contains `snapped`, `distanceFromRouteMeters`, `distanceTravelledMeters`, `remainingDistanceMeters`, `remainingDurationSeconds`, and `fractionComplete`. It is null when live ETA is unreliable. The same state is delivered to `onState`.

Statuses are `idle`, `resolving`, `waiting_location`, `routing`, `navigating`, `rerouting`, `arrived`, `error`, and `stopped`. Route warnings about missing entrance access and unverified riding permissions still apply. A malformed provider result produces `INVALID_ROUTE` rather than live progress over invalid geometry.

## Scope and validation

The implementation supports the movement/progress/rerouting foundation of a navigation app. It does not provide traffic, indoor routing, voice guidance, background GPS, or surveyed path permissions. Actual campus entrances and riding permissions still need auditing. ETA remains an estimate using the configured mode speeds.

Tests simulate GPS, time, permission errors, out-of-order fixes, route races, arrival, watch cleanup, and an actual bundled campus path. No user location permission is requested during testing. Run `npm test` in this folder. The original two-point preview remains separate and unchanged in behavior.
