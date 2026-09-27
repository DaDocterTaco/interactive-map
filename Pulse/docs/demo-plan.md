# Campus Pulse — agreed demo scope

Status: backend foundation implemented and tested locally; interface, integration, hosting, and real-device rehearsal are still pending. No production Firebase deployment has been made. See [data-model.md](data-model.md) for the database structure and [../README.md](../README.md) for the feature folder layout.

## Goal

Show three real students on separate devices opt in, receive the same meetup proposal, accept, enter one shared chat, find a specific public campus meeting point, and check in. Start with a small catalog that can be expanded by adding meeting spots.

## Decisions from Victor

- First release is a hackathon demonstration for judges.
- Coffee: Café Bustelo at the Graham Center (GC), as selected by Victor.
- Food: a meeting spot at Chick-fil-A on campus.
- Conversation: outdoor benches near a pond. Selected mapped candidate: the three-bench cluster east of Kissing Pond, beside the Turtle Pond area and west of Green Library.
- Three devices will be available for testing.
- Firebase already exists; the site is not hosted yet.
- Support both a manual “I'm here” button and optional automatic check-in using device location.

## Details still needed

- Venue choices are resolved: Café Bustelo at GC and the mapped pondside bench cluster described below. The exact on-site coffee waiting position and current bench condition still need a rehearsal check, rather than another venue-choice question.
- Verify the exact Chick-fil-A meeting landmark and coordinates as well; identifying the restaurant does not establish its entrance or waiting area.
- Validate all three pins and their public accessibility before enabling them for real matching. Do not use building center coordinates as verified meeting points.
- Confirm the demo time and the venues' availability before rehearsal. Do not promise that food or coffee counters are open without supporting information.

## Selected meeting locations

| Activity | Venue / meeting instruction | Mapped point | Verification status |
| --- | --- | --- | --- |
| Coffee | Café Bustelo, Graham Center. Proposed instruction: meet beside the Café Bustelo counter, clear of the ordering line. | 25.7565323, -80.3723891 | Venue chosen by Victor, supported by FIU sources and a current OpenStreetMap café record. This is a venue point, not a surveyed indoor waiting position. |
| Food | Chick-fil-A on the MMC campus. | To verify against the selected restaurant entrance. | Previously selected; precise waiting area still pending. |
| Chat outdoors | The cluster of three benches on the east side of Kissing Pond, in the Turtle Pond area west of Green Library. Use the southern bench as the shared pin. | 25.7568537, -80.3750515 | Three bench records are present in the live OpenStreetMap API; current physical condition and access have not been field-checked. |

The selected bench is [OpenStreetMap node 6301910957](https://www.openstreetmap.org/node/6301910957). The other two mapped benches are nodes 6301910958 (25.7568952, -80.3750484) and 6301910959 (25.7568641, -80.3750366). The small cluster provides a more specific meeting location than the whole pond or bridge. Comparing the project’s OSM pond outlines to the bench coordinates places the selected bench approximately 21 meters from the Kissing Pond water edge; this is a map-based geometric estimate, not a walking-route measurement.

Research checked on 2026-09-27: the live OSM bench records were last edited in 2019, and the Café Bustelo record in 2022. Their continued presence in the database does not establish their present on-site condition. Check the benches and coffee waiting area during rehearsal before enabling automatic check-in at those pins. No opening hours or seating availability have been assumed.

Venue evidence:

- [FIU: Café Bustelo in the Graham Center](https://news.fiu.edu/2022/cafe-bustelo-pilon-announce-1.25-million-gift-to-fiu-chaplin-school-of-hospitality-tourism-management-and-fiu-casacuba)
- [Café Bustelo mapped venue](https://www.openstreetmap.org/node/3404110005)
- [FIU: Kissing Pond and Bridge](https://admissions.fiu.edu/viewbook/explore-the-possibilities/)
- [FIU: campus highlights including Turtle Pond](https://www.fiu.edu/student-life/campus-highlights/)

## Existing code inspected

Source inspected: `C:/Users/Victor/Desktop/Extra/HackAthon/interactive-map`.

- Firebase Anonymous Authentication restores a browser identity through `LiveChat/chatAuth.js`.
- Firestore messages, public/password groups, direct conversations, and membership rules already exist.
- The map mounts location services. Tracking is opt-in and kept in memory by the current location module.
- The current class “Directions” behavior locates a building on the map; it is not walking-route calculation or evidence of physical arrival.
- The existing Python endpoint serves the campus assistant. No Pulse coordination backend was found in the inspected source.
- Local Firestore rules contain a temporary read/write fallback for collections outside the existing protected list. New Pulse collections must be excluded and explicitly protected before use. Deployed rules have not been checked.
- No hosting or Cloud Functions configuration was found in the inspected Firebase configuration.

## Foundation work, in order

1. **Shared identity and test environment.** Reuse the current Firebase identity from a Pulse entry point. Create a shared HTTPS demo address and verify all three phones can authenticate, refresh, and exchange messages. Use a separate emulator/test environment while developing; do not seed invented students into the real demo.
2. **Protected backend coordination.** Add server-side proposal and confirmation operations with Firestore transactions and repeat-safe IDs. Protect availability, location inputs, responses, meetups, and participant-only chat access. Derive the caller from authenticated credentials.
3. **Meeting-spot catalog.** Store stable spot IDs, activities, precise landmarks, verified coordinates, and an enabled/disabled flag. Unverified entries stay disabled. Matching and the destination map must use the same spot data.
4. **Meetup lifecycle and chat integration.** Separate availability expiration, proposal response deadlines, meetup end, and chat grace-period end. Confirmation creates one meetup and one chat for accepted participants only. Recover state after refresh or reconnect; recheck time and conflicts when confirming.
5. **Arrival controls.** Implement manual check-in and opt-in automatic check-in, then test both on the three devices at the selected campus locations.

The first implemented path should support coffee, food, and chatting; groups of two to four; acceptance from at least two people; honest waiting/expiry states; cancellation and leaving; and no silent replacement participants.

## Automatic check-in behavior

Automatic check-in is an optional convenience for an accepted participant in an active meetup. It must not turn on location tracking merely because someone opened Pulse.

- Request location only after the participant enables automatic check-in.
- Evaluate fresh device fixes against the verified meeting pin, using both measured distance and reported accuracy. Do not check in from a single stale or low-accuracy position.
- Start testing with a conservative rule: at least two distinct fixes spanning 10 seconds, each no older than 15 seconds, accuracy at most 25 meters, and distance plus reported accuracy within a 40-meter radius. These are initial test parameters, not a validated guarantee of arrival. Adjust only after field testing the selected spots.
- Indoor GPS may not distinguish the coffee counter from another nearby GC venue. If the location is inconclusive, explain that briefly and leave manual check-in available.
- Stop the watch after check-in, opting out, leaving, meetup end, or hiding/exiting the page. Ask for a new tap to resume after returning.
- Check-in records identify the participant, method, and server time. Do not publish precise device coordinates or movement history to other participants. Any transient coordinates sent for server validation must not be retained in ordinary logs or public records.
- Validate membership and meetup time on the server for both methods. Device GPS and manual check-in are participant signals, not verified proof of identity or physical presence.
- Moving the map camera to the destination never counts as arrival.

## Demo acceptance checks

- Three phones see one proposal with consistent activity, spot, timing, and responses.
- Simultaneous acceptance and repeated taps create one meetup and one chat.
- A decline or timeout never grants chat access; outsiders cannot read private matching locations or meetup messages.
- Expired availability stops matching without waiting for deletion; waiting and deciding consume the original available time.
- Refresh/reconnect restores the current state without rejoining or duplicating the meetup.
- Manual check-in updates the other participants. Accurate fresh location can trigger automatic check-in; stale, denied, approximate, and distant location cannot.
- If leaving reduces a confirmed group below two, the remaining participant sees a cancellation.
- The meetup ends on schedule; chat remains available only for its communicated grace period.
- No match is represented honestly, with an option to cancel.

## References used during planning

- Firebase callable backend functions: https://firebase.google.com/docs/functions/callable
- Firestore transactions: https://firebase.google.com/docs/firestore/manage-data/transactions
- Browser geolocation requirements: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API
- FIU campus venue map (for subsequent pin verification): https://campusmaps.fiu.edu/

Venue sources help identify candidates; exact meetup pins still require verification.
