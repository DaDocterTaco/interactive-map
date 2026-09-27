# Class navigation

The main app now connects **Find this class** to the navigation engine. Select a class and tap the action to close search, mark its building, highlight the outdoor path, and show distance and estimated time in the existing class popup.

## Try the app

1. Open the main app and choose **Find a class** in the campus menu.
2. Search for class ID **85209** (COP 2047, INV1 room 302), choose the section, then tap **Find this class**.
3. Allow location to navigate from a fresh on-campus GPS fix. If GPS is unavailable or you are off campus, expand **Choose a starting point**, enter **GC** or **Graham Center**, and tap **Use this start**. This example is about 782 metres / 10 minutes walking on the bundled graph.
4. Change Walking / Bike / Scooter to recalculate. **Pick on map** accepts a clicked coordinate. **Show route** restores the route overview after panning.
5. Dismiss the popup or return to class details to clear directions. Choose another class to replace the destination.

GPS progress and ETA update continuously. Bad or stale readings pause the live estimate. Confirmed deviations trigger a throttled reroute. Two accurate readings near the requested building confirm arrival. A manually chosen start gives a static estimate until **Use live location** is selected. The chosen start and travel mode persist for this page session only.

Routes lead along outdoor paths toward the building; the room is shown for reference. Entrance gaps and indoor travel are excluded. Estimates use 3 mph walking and 15 mph biking/scooting. Unknown riding access uses provisional riding times; explicit dismount sections still use walking speed. **Route details** explains the assumptions. Manual planning and live remaining time use the same mode speeds. Spoken instructions, indoor floor plans and background tracking are not included.

## Integration boundary

- `index.html` mounts location services, creates `createClassNavigation({map,L,locationServices})`, then passes it as `navigation` to `mountClassSearch`.
- `classNavigation.js` owns the popup controls and its route layer. It exposes `start({location,panel})`, `frame()`, `getState()`, `stop()` and `dispose()`.
- `classNavigationSession.js` owns journey/source changes and GPS subscription lifecycle. It starts at most the existing location service's single watch, stops watches it started, and preserves one that was already running.
- `locationservices/leafletLocation.js` exposes subscriptions and camera-follow preferences. Class directions suspend automatic GPS panning while the overview is shown and restore the prior preference on dismiss. Existing location actions still work.
- The routing core, provider, public API and data remain reusable by other sections. No third-party package or new paid service is introduced.

Returning from a hidden tab requires **Use live location** to restart the paused GPS service. Real phone location requires an appropriate browser permission and secure hosting. Arbitrary off-campus addresses still need a configured geocoder and routing provider; the campus name/coordinate inputs do not pretend to support worldwide routing.

## Checks

From the app root:

```sh
node --test navigation/tests/*.test.mjs ClassSearch/classData.test.mjs ClassSearch/classMotion.test.mjs
```

`sharedLocation.test.mjs` tests the existing sibling location service. If copying only the portable engine to another host, omit this app-specific test and the class browser fixture.

Open `/navigation/tests/classNavigation.fixture.html` for a clearly labelled simulated-GPS test page using the production modules and class catalog. Its controls can move the position, block permission, weaken accuracy and simulate arrival; it never reads real GPS. This checks browser integration, not real-world device accuracy. Field-test campus routes and entrances before relying on the estimates for public navigation.
