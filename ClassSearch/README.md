# Class search on the campus map

**Open Class**, directly below Open chat, opens an independent modal dialog. No chat sign-in is needed.

Students choose **Course & professor** (course code or title; optional professor and exact starting time) or **Class ID** (the section number). Results are ordered by start time and show professor, section, class ID, meeting pattern, exact dates, assigned room, and building. Select a result, select a meeting location if it has more than one, then use **Locate class**. The dialog closes and a dedicated blue C marker identifies that building at zoom 18. The marker popup retains the selected class details. Selecting another class replaces only this marker, preserving the building and warning layers.

Data: `classes.json`, a 1.28 MB normalized snapshot containing 1,886 sections for **Fall 2026 (1268), MMC**, checked September 26, 2026. The browser fetches this file on the first submitted search and reuses it in memory. The host can enable ordinary gzip/Brotli compression (the JSON is about 94 KB gzipped). No SQLite server, Firebase read, per-search network request, package install, or student ID login is required. Public source records are bundled; updates are not live.

Locations display **Assigned in FIU 25Live** only when schema version 2 includes a verified flag, check timestamp and assignment label for that section. Every retained section passed exact identity, profile, time and assigned-room checks for every active date. Older or incomplete records show **Assignment not verified**. PAD 6807 RX02 (90423) was excluded because ten dates have no public assignment. Pins identify buildings, not doors or indoor/walking routes. Exact dates are preserved, including holiday exclusions. A missing result means the section is absent from this usable-location snapshot, not that FIU does not offer it. Private, online, cancelled, ambiguous and otherwise unusable source records were excluded in the audit. Assignments can change after this snapshot.

Files:

- `classData.mjs`: normalization, search, grouped locations/dates, lazy loader, formatting.
- `classSearch.js`: accessible native dialog, result selection, pagination, safe text rendering, dedicated Leaflet marker.
- `classSearch.css`: scoped dialog, result and map marker styles.
- `classes.json`: compact data; deploy only this copy, not the original audit/cache or SQLite file.

Run `node --test ClassSearch/classData.test.mjs`. Serve the project root over HTTP, as for the existing map. To refresh, rebuild a newly audited dataset and replace `classes.json`; update the initial term label in `classSearch.js` if the semester changes. The source workspace retains the full audit and database build scripts.

The UI uses the native [dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) for focus containment and Escape dismissal, and the existing [Leaflet 1.9.4 marker and map APIs](https://leafletjs.com/reference.html). All dynamic source content is rendered with `textContent`.
