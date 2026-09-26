# Chat and forums visual implementation

The light and dark reference designs are implemented in the existing app at:

`C:/Users/Victor/Desktop/Extra/HackAthon/interactive-map`

Open http://localhost:8000/index.html, select **Open chat**, then **View profile** to switch themes. A selected theme is remembered in this browser. Without an explicit selection, the interface follows the system theme.

## Implemented

- Glass bottom sheet, reference sidebar, blue messages, avatar initials, typography, dividers, profile footer, and persistent message composer.
- Responsive mobile conversation/list navigation, including Back to chats and a reachable close button.
- Custom sheet, message, menu and dialog transitions; focus/hover states and reduced-motion support.
- Sending/sent feedback, retained message drafts, explicit failure/retry feedback, and scroll-preserving incoming-message handling.
- Custom moderation confirmation/reason dialogs with permission checks retained.
- Existing group, private-access, people, friend and forum/report workflows styled consistently with both themes.
- Cache-busted map integration so the HTML, CSS and chat module load the same version.

Existing Firebase services, rules and user roles were preserved. Existing map/Campus3D work was preserved. The selected reference's FIU masthead and illustrative map are outside the requested chat implementation.

## Verification

17 regression checks passed in the actual app directory:

```powershell
node --test LiveChat/tests/chat-ui.test.cjs LiveChat/tests/group-ui.test.cjs LiveChat/tests/people-ui.test.cjs LiveChat/tests/forum-ui.test.cjs LiveChat/tests/alert-ui.test.cjs LiveChat/tests/map-warnings-ui.test.cjs LiveChat/tests/report-clock.test.cjs
```

Real-browser interaction checks cover Enter/send, delayed and failed send/retry, drafts across chat switches, private access, forum navigation, mobile navigation, theme persistence, and the actual map/Firebase connection. The production check read existing messages and verified the current account's moderator controls; it did not create or delete production messages.

## Screenshot evidence

The `evidence/light-desktop.png`, `dark-desktop.png`, `light-mobile.png` and `dark-mobile.png` files are browser captures of the implemented HTML/CSS/renderers using an isolated in-memory conversation that exactly matches the reference content. They do not imply that Maya/Jordan/sample groups were inserted in Firebase.

`evidence/live-map-light.png` and `live-map-dark.png` are the actual map and real Firebase conversation. `compare-*` files put the selected reference chat crop beside the implemented chat using normalized dimensions. The screenshots were not retouched.

See `design-qa.md` for the visual review, corrections, viewport checks and known minor rendering differences. The isolated fixture and its preparation instructions are documented in `qa/README.md`; it runs on port 8050 independently of the actual app.
