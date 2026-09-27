# Campus Pulse UI

The approved seven-screen direction is implemented in the existing Pulse feature. The production mount uses the app's Firebase services, campus map, theme and public profiles. The separate preview uses Firebase emulators and explicitly labels test participants.

## Organization

| File | Responsibility |
| --- | --- |
| `client/mount.js` | Connect app authentication, map, profile lookup, avatar rendering and profile opening. |
| `client/pulse.js` | Existing Pulse subscriptions, matching flow, requests, arrival tracking and modal lifecycle. |
| `client/view.js` | Accessible markup for setup, waiting, proposal, meetup, chat, errors and confirmation. |
| `client/presentation.js` | Dynamic content, avatars, chat scroll/unread state, responsive tabs, theme controls, busy feedback and viewport handling. |
| `client/maps.js` | Read-only Leaflet previews with public meeting coordinates and attribution. |
| `client/pulse.css` | Scoped design tokens, responsive layouts, dark theme, states, transitions and reduced-motion overrides. |
| `client/icons/` | Bundled official Tabler SVG assets and MIT license. |

The UI keeps real matching deadlines, participant responses, messages and check-ins. It does not substitute fixed mockup times, invented profiles, fake routes or simulated success responses. Request-specific display preferences are stored in sessionStorage; precise starting coordinates are not added to that storage or shown to the group. A restored request without saved labels uses neutral wording rather than claiming the user selected a default location.

## Interaction details

- Setup supports Coffee, Food and Hang out, available time, walking limit and a public starting spot or the existing location action.
- Waiting shows a subtle pulse, remaining availability, the search summary, Keep exploring and cancellation. An in-app card reports matches and confirmations while the user explores other tabs; see `BACKGROUND-WAITING.md`.
- Proposals show the venue, real map, response deadline, live participant status, acceptance, passing and response withdrawal.
- Confirmed meetups use a split details/chat layout on desktop and keyboard-accessible Details/Chat tabs on mobile.
- Chat preserves scroll position, counts unread messages, offers a new-message jump, supports Enter to send and Shift+Enter for a line break, and keeps the composer visible on narrow/short screens.
- Manual arrival shows a success toast, updates participant status and informs the group. Optional automatic arrival keeps the existing accuracy, dwell and privacy checks.
- Leaving requires an inline confirmation; Stay cancels it. Escape closes the dialog and restores focus to its launcher.
- Controls have selected, hover, focus, disabled and busy states. Errors can be dismissed and corrected. Stage/message transitions respect reduced-motion CSS.

## Validation and proof

13 unit/policy tests and 10 Firebase-emulator integration tests passed. A browser rehearsal with three separate identities exercised matching, acceptance, passing, messages, unread state, manual arrival, reload recovery and leaving. Screens were inspected at desktop and phone sizes, including 320px width and a 390 x 430 short viewport.

The workspace contains `proof/index.html`, a self-contained gallery of all seven mockups beside native browser screenshots; `proof/README.md` indexes the captures. `design-qa.md` records the visual comparison and remaining test limits. These proof files are deliberately excluded from installation into the public app.

Physical phone keyboard behavior and automatic GPS check-in still need an on-campus rehearsal. Reduced-motion behavior was checked in source, not by changing the operating system preference. Browser screenshots establish appearance, not animation timing; animation behavior was exercised in the browser.

## Installation and rollback

From this Pulse directory, review with `node scripts/install.mjs <app-directory>` and apply with the same command plus `--apply`. The installer copies managed Pulse files, updates the entrypoint references and limits the local server to public browser assets. It refuses to overwrite independently changed managed files. Existing versions are backed up under the destination's `Pulse/.integration-backup/<timestamp>/`; inspect that backup before restoring specific files.

No Firebase rules, billing tier or production data migration is required for this UI change. The preview's short forced-long-polling settings apply only to local emulator traffic.
