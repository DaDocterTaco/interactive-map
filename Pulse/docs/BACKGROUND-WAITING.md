# Keep exploring while Pulse searches

Users can choose **Keep exploring**, close Pulse, go back to Community, or switch to another app tab without canceling their availability. Firebase subscriptions and the existing matching timer continue for the mounted app. Only **Stop looking** cancels the search.

A compact in-app card provides the return path:

- Waiting: “Pulse is still looking” and Open Pulse.
- New proposal: “We found your group!”, the public venue, the live response countdown, and View plan. The Community tab also gets a badge and the browser title indicates the match.
- Accepted: “You’re in. Waiting for your group.”
- Confirmed: “Your meetup is confirmed” and Open meetup.
- Offline/stale: reconnecting feedback replaces claims about a fresh match.

The card does not move keyboard focus or navigate automatically when a match arrives. Opening it restores the correct Pulse screen, including when the shared app shell has kept the dialog open in a hidden tab. Expired proposals stop advertising a response action. Canceling, leaving, signing out, or session expiry clears obsolete session details. Reloading restores a still-active session from Firebase.

These are **in-app notifications while the site remains open**. This change does not add operating-system push, email, service workers, or closed-tab delivery. Matching still respects the existing page-visibility and network rules. No Firebase billing or database-rule change is required.

## Implementation

`client/background-state.js` derives account-specific notification state and filters expired/irrelevant plans. `client/background.js` manages the card, navigation badge, browser title, app-tab visibility and cleanup. `client/pulse.js` retains the matching subscriptions and connects the new Keep exploring action. The original public CampusUI registration/camera integration was preserved.

The card uses a non-modal popover and is mounted inside an active native modal when needed, because content outside that modal is inert. Clicking its return action requests normal dialog closure and respects any cancel/unsaved-change guard; it never forces the editor closed. References: [HTML modal inertness](https://html.spec.whatwg.org/dev/interaction.html#inert) and [requestClose](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/requestClose).

## Verification — 2026-09-27

19 tests passed with `npm test`, including six new notification-state tests for ownership, deadlines, acceptance/passing, confirmation, offline state and cleanup. No matching/rules changes were made, so the previous integration suite was not rerun for this UI-only change.

Browser testing used two independent Firebase emulator identities with the actual app's CampusUI shell assets served read-only. The class-search surface was explicitly a test input, not a production class database.

1. Alex started availability, selected Keep exploring, opened Classes and typed `COP 3530`.
2. Sam opted in. A real matching proposal produced the notification and Community badge for Alex. The class input kept both its text and focus.
3. View plan opened the correct proposal. Alex accepted and returned to Classes; Sam accepted. Confirmation appeared while Alex's Pulse panel remained hidden.
4. A native test dialog retained an unsaved note when its cancel guard blocked navigation. After clearing the guard, Open meetup closed it normally and returned to Pulse.
5. A 390 x 844 mobile viewport showed the full notification and its action without horizontal overflow. Keep exploring was visible near the waiting heading.
6. Waiting survived reload. Stop looking removed the card, badge and title cue. Leaving the prior test meetup also cleared its status.
7. Browser error logs were empty in the checked rehearsal views.

Unedited screenshots are in the workspace's `proof/background-session/` directory. That directory is excluded from app installation.
