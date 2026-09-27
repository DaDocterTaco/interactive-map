# Three-device demo

The three agreed destinations are:

| Activity | Spot | Meeting instructions |
| --- | --- | --- |
| Coffee | Café Bustelo, Graham Center | Beside the counter, clear of the ordering line. Check hours. |
| Food | Chick-fil-A, PG5 Market Station | Ground-floor restaurant entrance, clear of the ordering line. Closed Sundays; check hours. |
| Hang out | Kissing Pond benches | Southern bench of the cluster east of the pond, west of Green Library. |

Victor confirmed that the places exist and identified Chick-fil-A as PG5 on 2026-09-27. The restaurant's published directions provide its pin at 25.76012, -80.37164073: https://www.chick-fil-a.com/locations/fl/florida-international-university

Other mapped sources are recorded alongside each catalog entry. These are demo meeting pins, not a survey of exact indoor door coordinates. onSiteRehearsed remains false until an actual phone walkthrough. Manual arrival is the fallback when indoor GPS is imprecise.

## Judge walkthrough

1. Open the campus app on three independently signed-in devices.
2. Choose Coffee, 45 minutes and a starting spot near Café Bustelo on each.
3. Tap Find my group on all three within a few seconds. Keep the pages visible.
4. Show the same proposed group and spot on each phone.
5. Accept on all three before the countdown ends.
6. Send a short message and show it arriving on the other phones.
7. Tap I'm here and show the arrival state synchronizing.
8. Optionally test automatic arrival with location permission and accurate fixes at the pin.
9. Leave the meetup; show that the departing person loses chat access and a group with fewer than two remaining members closes.

For Food from Graham Center, allow enough walking time to reach PG5; a five-minute walking cap may correctly exclude it. Selecting the destination itself as the starting point supports an indoor judge walkthrough without sharing GPS. This is an explicitly chosen starting place, not a claim about the phone's current location.

Keep the site reachable over HTTPS for real-phone GPS. All devices use the real Firestore database on Spark once the catalog and rules are deployed. No laptop backend is required by the application; a locally served website still requires its hosting laptop.

## Acceptance evidence

Automated rules/SDK tests cover concurrency, privacy, late responses, cancellation, arrival and expiry. A three-session browser rehearsal confirms the visible matching, acceptance, chat and manual arrival flow. This does not substitute for real-phone GPS and campus Wi-Fi testing.

Cloud Functions, billing upgrades, paid scheduled cleanup and automatic deletion promises are excluded from this demo design.
