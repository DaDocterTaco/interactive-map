# Class finder

Responsive class search integrated with the existing Leaflet map and chat theme.

Desktop uses a search/result pane, section details and a map preview; at widths up to 700px the selected result expands into inline details. In the main app, **Find this class** opens the map with the building, outdoor route, travel mode and estimated time in the class popup. It uses live GPS or a manually chosen campus start. The optional adapter lives in `navigation/`; see [CLASS-NAVIGATION.md](../navigation/CLASS-NAVIGATION.md).

## Behavior

- One field accepts a course code, partial department/code, title, or exact numeric class ID. Search is debounced 220ms; Enter runs immediately.
- Optional professor/start-time filters; explicit selection, local pagination, exact meeting dates and multiple-location selection.
- Catalog loaded once, including concurrent searches. Failed loads can retry; stale asynchronous results are ignored after edits or close.
- All catalog text is rendered with textContent. The class layer is separate from existing map markers and warnings.
- Native dialog focus handling, Escape/backdrop dismissal, visible keyboard focus, selected/pressed state, live status feedback and small-screen scrolling.
- With navigation supplied, the adapter frames the path and building above the popup, updates progress from shared GPS, and clears the journey on dismiss or return to search. Reduced motion uses immediate placement. Hosts that omit `navigation` retain the existing 2.8-second building-only camera transition.
- Live chat theme variables supply light/dark surfaces. The primary action color is #0449d3 from the approved mockup.

## Data and map assets

`classes.json` is the existing Fall 2026 MMC snapshot, with source and verification metadata preserved. It is not live enrollment data. Catalog pins represent buildings, not verified entrances or interior room locations.

`buildings.geojson` is derived from the existing local OpenStreetMap campus extract, using only polygons containing the corresponding catalog pin. It covers 22 buildings, including INV1; other classes retain their catalog pin without a fabricated outline. © OpenStreetMap contributors, ODbL; attribution is retained in both maps. Tiles use the existing OpenStreetMap tile service.

`assets/` contains unmodified Bootstrap Icons 1.11.3 from https://github.com/twbs/icons/tree/v1.11.3/icons, licensed under the accompanying MIT LICENSE. Shared search/filter/close/check/chevron icons remain in LiveChat/assets/icons.

## Files and checks

- `classSearch.js`: responsive UI, catalog interaction, preview and map-selection lifecycle.
- `classSearch.css`: scoped styles, theme integration and responsive/motion rules.
- `classData.mjs`: catalog parsing, formatting and matching.
- `classMotion.mjs`: interruptible, reduced-motion-aware camera movement.

Run `node --test ClassSearch/classData.test.mjs ClassSearch/classMotion.test.mjs` from the app root. No new runtime dependency is required.

For the combined navigation/class checks, run `node --test navigation/tests/*.test.mjs ClassSearch/classData.test.mjs ClassSearch/classMotion.test.mjs`. Browser testing with simulated GPS is available at `/navigation/tests/classNavigation.fixture.html`; it imports the same production modules and catalog without requesting real device location.

Visual proof and comparison notes are linked from the app-root `design-qa.md`. Existing class files and index were backed up before installation; unrelated chat changes were preserved.
