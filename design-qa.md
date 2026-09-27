# Class finder — visual and interaction QA

final result: passed

Verified September 26–27, 2026 in the Codex in-app browser against the installed app at http://localhost:8000/. The class implementation is in this repository.

## Visual truth and capture normalization

Approved source images are stored in a local QA reference set outside this repository.
Browser screenshots are stored in a local QA proof set outside this repository.

| State | Source | Browser screenshot | CSS viewport / screenshot pixels |
|---|---|---|---|
| Desktop, selected COT 3100 U01 | `01-desktop-directions.png` (1536×1024) | `desktop.png` | 1536×1024 / 1536×1024 |
| Mobile, selected details | `02-mobile-class-details.png` (853×1844) | `mobile-details.png` | 390×844 / 390×844 |
| Mobile, building located | `03-mobile-building-location.png` (853×1844) | `mobile-location.png` | 390×844 / 390×844 |
| Tablet | Responsive behavior derived from desktop | `tablet.png` | 834×1194 / 834×1194 |
| Smaller phone, arrival | Responsive behavior derived from mobile | `small-phone-location.png` | 320×568 / 320×568 |
| Dark theme | Existing chat tokens | `desktop-dark.png` | 1536×1024 / 1536×1024 |

Mobile sources were proportionally normalized from 853×1844 to 390×843 for comparison; this one-pixel aspect-ratio rounding is not a layout defect. Browser devicePixelRatio was approximately 1. Windows/browser rasterization still produces subpixel edge differences. Early viewport captures taken while the in-app browser was resizing were discarded; final captures were made after reload at the verified innerWidth/innerHeight. Screenshots contain real rendered HTML, catalog data and Leaflet maps, not the generated mockup as a background.

## Comparison evidence

Source and implementation were inspected together, not from memory:

- `compare-desktop.png`: full composition, pane proportions, hierarchy and map placement.
- `compare-desktop-facts.png`: readable comparison of labels, schedule, location, dividers and icons.
- `compare-desktop-actions.png`: button sizing, labels, spacing and color.
- `compare-mobile-details.png`: normalized full mobile screen, with readable field labels and actions.
- `compare-mobile-location.png`: normalized map and arrival sheet.

## Findings and repair history

1. **[P2, fixed] Mobile footer exceeded the initial visible panel.** Evidence: `mobile-v1.png`, `mobile-v2.png`. Reduced row padding, corrected inherited form typography, and tightened the footer while retaining natural scrolling on smaller phones. Post-fix: `mobile-details.png`; the main action and Clear selection fit at 390×844. At 320×568 the content scrolls and Show on map was reached and activated successfully.
2. **[P2, fixed] Arrival sheet exceeded viewport width.** Evidence: `mobile-location-v1.png` and DOM bounds. Added border-box sizing to the sheet and removed the empty map-status paragraph's layout contribution. Post-fix: `mobile-location.png`, page scrollWidth 390 and scrollHeight 844 at a 390×844 viewport; no horizontal overflow.
3. **[P2, fixed] Preview cropped the building at tablet width.** Changed preview framing to fit the real footprint with padding and an upper zoom limit. Post-fix: `tablet.png` shows the whole outline. Building number now stays with the word Building when wrapping.
4. **[P2, fixed] Unnecessary desktop detail scrollbar and possible expanded-date overlap.** Assigned a bounded scrolling content area and measured footer allocation. Post-fix: collapsed content clientHeight/scrollHeight both 635; expanded dates scroll to 836 inside the same 635px area while Directions remains at y≈804, height 59. Final evidence: `desktop.png`.
5. **[P2, fixed] Fractional zoom could snap on interruption or repeated locate.** Disable Leaflet zoom snapping before stopping, restore afterward, and avoid the caller's redundant stop. Added a regression test simulating Leaflet stop rounding. Pointer, wheel, keyboard and explicit Stop movement interruption are supported; no false arrival is announced.

No actionable P0/P1/P2 findings remain in the tested states.

## Required fidelity surfaces

- **Typography:** Arial/Helvetica; desktop title 30px, selected course 42px, main facts 20px; mobile title 24px and main facts 16px. Hierarchy, wrapping and labels compared at normalized sizes. Mobile arrival uses a compact 20px room heading. Native rasterization differs slightly from the generated image.
- **Spacing/layout:** Desktop glass frame 1380×792 at the source viewport, with 18px inset, lavender search pane and white detail pane. Rounded frame/panes/controls match the source hierarchy. Mobile uses one expanded result and detail surface, followed by the map summary state. Footer and viewport framing were corrected through the iterations above.
- **Colors/tokens:** Shared chat text, muted, border, selected, surface and dark-mode variables. Primary action sampled from the approved source and implemented as #0449d3. Selected result uses blue fill, check and pressed state. Focus indicators remain visible.
- **Imagery/assets:** Real OpenStreetMap tiles and catalog building pins, with source-backed OSM outlines for 22 buildings whose catalog pin is inside a known footprint. INV1 outline verified against the existing local OSM extract. Other buildings retain a precise catalog pin without invented outlines. Icons are licensed Bootstrap assets; no generated raster UI, handmade SVG substitutes, or painted map images are used.
- **Copy/content:** COT 3100, U01, Richard Whittaker, Class ID 84848, Tue/Thu 8:00–9:15 AM, INV1 Room 302 preserved. Exact catalog dates appear in the disclosure. Desktop says Directions; mobile says Show on map and then Directions after arrival. Directions currently centers the building, as requested; route calculation and navigation are not implemented.

## Expected differences and P3 polish

- Live map tiles, real building geometry, geographic labels, map attribution and existing verified-warning indicators intentionally differ from generated geography. These are correctness requirements, not fabricated pixels copied from the image.
- Standard Bootstrap icons approximate the generated icons' meaning and style; the book, class ID and signpost silhouettes are not byte-for-byte identical to the AI-drawn glyphs.
- Minor native font, border and several-pixel spacing differences remain. This passes visual fidelity and functional QA, not a claim of literal pixel equality to every generated pixel.
- The arrival sheet includes a close control so the user can leave the selected-building state.

## Interaction verification

Passed in browser: course search, partial COT search (6 sections), direct class ID, filter expansion, unmatched professor empty state, resetting filters, keyboard selection, meeting-date expansion (29 actual meetings), mobile Show on map, desktop Directions, arrival state, Stop movement, resuming, return with selected section/search preserved, Escape and focus restoration to Open Class. Tablet and 320px phone have no horizontal overflow; the small phone can reach and activate the primary action by scrolling. Dark theme checked visually. Expanded desktop dates preserve the action area.

Camera movement uses a 2.8-second quintic easing curve with monotonic zoom, no zoom-out flight arc, and no popup-triggered second pan. It centers the pin in the map area above the summary. `gentle-location.gif` contains actual browser captures sampled during this transition; it illustrates the sequence, not a frame-rate benchmark.

16 automated tests pass: catalog identity and filters, prefixes, grouped room/date preservation, validation and retry behavior, monotonic camera movement, padded center, reduced-motion immediate placement, repeated locate, pointer/wheel/keyboard interruption, external movement, long frame gaps and fractional-zoom cancellation. Reduced motion was tested at the motion-module level and CSS inspected; OS-level reduced-motion emulation was not available in this browser surface.

Console inspection found no ClassSearch errors. One pre-existing Firebase Analytics installation fetch failure was recorded on the isolated preview origin; it did not prevent catalog/map use. No chat messages or database content were created during testing.

## Test limits

No physical-phone keyboard session, screen-reader session, or broad cross-browser/device performance benchmark was performed. No new claim of live enrollment/room availability is made. No route engine is included. Loading/error recovery is implemented; catalog fetch retry is covered by tests, not a forced browser network outage.

## Implementation checklist

- [x] Approved responsive layouts and shared theme
- [x] Unified catalog search, filters, details and selection
- [x] Actual building pin, available footprints and desktop preview
- [x] Gentle interruptible motion and reduced-motion path
- [x] Browser interaction, viewport and visual comparisons
- [x] Real screenshot and transition evidence saved
- [x] Actual application updated with backup of replaced files

final result: passed
