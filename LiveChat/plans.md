Connect chat to the map: Add a button on the map that opens the chat as the bottom sheet you described. Done
Finish the chat layout: Make it work well on phones, with the message list scrolling above the input. Skip for now
Add public groups: Let users create, discover, and join group chats. wokring on
Add private groups and direct messages: Store membership in Firestore and enforce it with security rules. D
Build warning reports: Let users choose a map location and describe a concern.  D
Add verification: Count confirmations from distinct users and allow an authorized verifier to approve a report.   D
Show verified warnings on the map: Add markers at their saved locations, with details when clicked.     F
Handle old reports: Let warnings be resolved or expire so the map stays useful. D
Tighten access and moderation: Decide who may clear chats, remove harmful messages, or act as a verifier. Right now, any signed-in Campus Chat user can clear it for everyone.

## Future ideas

- Add a 3D overlay aligned with the 2D campus map.
- Add clubs to the events section.
- Show the user's current location on the map.
- Improve the UI and UX across the map and chat features.
- Explore an AI feature that groups users with similar interests and plans an activity they can do together.
