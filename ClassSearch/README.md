# Class finder

Responsive class search integrated with the existing Leaflet map and chat theme.

Desktop uses a search/result pane, section details, an actual map preview and a **Directions** action. At widths up to 700px the selected result expands into inline details with **Show on map**; arrival reveals a compact building summary and **Directions**. Per the approved scope, Directions centers the actual building, not a walking route.

## Behavior

- One field accepts a course code, partial department/code, title, or exact numeric class ID. Search is debounced 220ms; Enter runs immediately.
- Optional professor/start-time filters; explicit selection, local pagination, exact meeting dates and multiple-location selection.
- Catalog loaded once, including concurrent searches. Failed loads can retry; stale asynchronous results are ignored after edits or close.
- All catalog text is rendered with textContent. The class layer is separate from existing map markers and warnings.
- Native dialog focus handling, Escape/backdrop dismissal, visible keyboard focus, selected/pressed state, live status feedback and small-screen scrolling.
- Map motion interpolates center and zoom monotonically over 2.8 seconds with quintic easing. It has no fly-out arc and supports interruption. Reduced motion uses immediate placement. The target is framed above the summary, not behind it.
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

Visual proof and comparison notes are linked from the app-root `design-qa.md`. Existing class files and index were backed up before installation; unrelated chat changes were preserved.
