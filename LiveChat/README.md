# Campus chats and forums

## People, friends, and direct messages

Opening chat saves the user's profile in `users/{uid}` with `uid`, `displayName`, lowercase `searchName`, `createdAt`, and `updatedAt`. These are public directory fields; no email, login token, or password is copied. Existing named accounts are backfilled once. Names can repeat, so results show a short user-ID suffix.

The sidebar search filters groups and queries Firebase for user names beginning with the entered text, ignoring case (up to 25 people). Select a person to open a direct chat or use Save friend. Friends are saved in `users/{uid}/friends/{friendUid}` with the friend's ID, stable direct-chat ID, and saved timestamp. Only the owner can read or change their list. Removing a friend preserves messages.

Direct conversations remain under `chats`, with a stable ID derived from both user IDs, `visibility: "direct"`, and exactly two immutable `participantIds`. Only those two participants can read the conversation or messages. The app shows the other person's name. Opening the same pair from either account reuses the chat. Direct messages do not expire.

Groups have a Members button for selecting people to message or save. Campus Chat and DMs do not show it. `chats/{chatName}/people/{uid}` contains only the member's user ID and is readable only by members of an open group. Password proofs remain separate and cannot be listed by other members. Group creation, password admission, and access approval also create a directory entry atomically.

`people.js` handles profiles, search, friends, and direct chats; `peopleUI.js` handles the lists and member dialog. User IDs and DMs use stable IDs rather than display names to avoid mixing accounts that share a name.

Additional checks: `node LiveChat/tests/people-ui.test.cjs` and `firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/people.test.mjs"`.

## Forums

### Warning reports

Choose **Forums → + Report alert**, enter a title and description, name the landmark, and click the separate location picker (or enter latitude and longitude). Reports start in Forums; only an approved report appears on the main campus map.

Alert posts use `category: "Alert"` and add `location: {label, latitude, longitude}`, `confirmationCount`, and `lastConfirmationBy` to `forums/{postId}`. Coordinates are validated and saved for future map integration. Existing discussion types and replies still work. Filter by Alert or search for a location name to find reports.

Other signed-in users can select **I can confirm this** or withdraw their confirmation. Each account has at most one record at `forums/{postId}/confirmations/{uid}` containing `userId`, `name`, and a server `createdAt`. The author cannot self-confirm. Transactions and rules keep the count consistent with these records and prevent direct count changes. Live listeners update the feed, thread, and the viewer's confirmation state. Confirmations count distinct Firebase accounts, not verified people; anonymous users can create another identity by changing browsers or clearing saved authentication. Confirmation counts do not automatically approve a report.

### Verified warnings on the map

Approved alerts appear as orange **!** markers at their stored coordinates. Click or keyboard-activate a marker for its title, concern, landmark, confirmation count, reporter/time, and verifier/time. Reports with identical coordinates share a marker whose popup lists each report. Building markers remain separate, and new warnings do not move the map camera.

`warningService.js` listens to `forums` where `verification.status == "approved"`. `warningMarkers.js` renders the dedicated Leaflet layer and safe DOM popups; `mapWarnings.js` handles authentication and listener cleanup. `mapWarnings.css` styles the markers and status legend. No duplicate warning collection or extra composite index is needed. This query covers all approved reports, including ones older than the forum's currently loaded page.

Warnings use the existing Firebase sign-in. Returning users see them immediately; first-time visitors use **Open chat** to sign in. Signing out removes markers. The legend reports loading, zero warnings, saved/offline data, and connection errors. Pending local approvals and invalid coordinates are excluded. When the server removes approval, resolves, or deletes a report, its marker disappears on the next snapshot. Expiration removes markers on a local deadline timer without needing another Firestore write.

The current Firestore rules must be deployed before clients can approve or resolve reports. No live reports are auto-approved, resolved, or seeded for testing.

Checks: `node LiveChat/tests/map-warnings-ui.test.cjs` and `firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/map-warnings.test.mjs"`. The tests cover approved-only rendering, live additions/updates/removals, shared-location popups, safe text, and auth lifecycle. References: [Leaflet markers and popups](https://leafletjs.com/reference.html#marker), [Firestore realtime listeners](https://firebase.google.com/docs/firestore/query-data/listen).

### Authorized verification

Alerts show **Awaiting verifier review** until an authorized verifier selects **Approve report**. Approved reports show a verified label in the list and the verifier's name and approval time in the thread. Verification is separate from the community count; confirmations, withdrawals, and replies still work afterward. The author cannot approve their own report, even if they are a verifier.

Approval adds the immutable `verification` map to `forums/{postId}`: `status: "approved"`, `verifierId`, `verifierName`, and server `approvedAt`. Old alerts without this map are pending review; no migration is needed. Firestore checks the current role on every approval and blocks injected approval fields on report creation, unauthorized approvals, altered counts, and overwritten approvals.

To authorize a verifier, a project administrator creates `users/{EXACT_FIREBASE_UID}/roles/verifier` with Boolean `enabled: true` through the Firebase Console or a trusted Admin tool. Set it to `false` to revoke access. Use the UID, because display names can repeat. Clients can read only their own verifier role and cannot create, edit, or delete roles. A public profile field or local browser change cannot grant permission. The app listens for role changes; revocation prevents future approvals while preserving past approval records. Anonymous verifier identities remain tied to that saved browser account.

The role-document approach follows [Firebase's role-based access guidance](https://firebase.google.com/docs/firestore/solutions/role-based-access). Run `firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/verification.test.mjs"` for approval, duplicate-account, concurrent-verifier, privilege-escalation, and revocation checks.

### Resolved and expired warnings

Warnings expire **24 hours after the original server `createdAt`**, whether approved or still awaiting review. Confirmation, approval, and replies do not extend that deadline. This also applies to older alerts without a schema migration. Forums retains the report, original approval, confirmations, and replies, and labels it **Expired**. Expiration means stale, not confirmed fixed.

Before expiry, the original author or a currently authorized verifier can select **Mark resolved** with an optional note (500 characters). Firestore saves an immutable `resolution` map containing `status: "resolved"`, `resolvedBy`, `resolvedName`, server `resolvedAt`, and `note`. Other readers cannot close the report; clients cannot overwrite a resolution, reopen it, or change its creation time. A resolved report is labeled with who closed it and when. Its marker disappears from connected maps while history remains readable and replyable.

`forums/reportLifecycle.js` derives active/resolved/expired status, schedules the nearest deadline, and rechecks after tab suspension. Both the Forums view and the map use it. The browser compares local time to a deadline based on the stored server timestamp; Firestore uses `request.time` to enforce closure independently of the browser clock. No scheduled deletion, TTL policy, or background job is required; an expired status field is not written to Firestore. The map query can return historical approved reports, but the renderer displays only active ones. Rules reject new confirmation changes, approval, or resolution after expiry; resolved reports also reject further confirmation changes and approval. Replies remain allowed for discussion/history.

Checks: `node LiveChat/tests/report-clock.test.cjs`, `node LiveChat/tests/alert-ui.test.cjs`, `node LiveChat/tests/forum-ui.test.cjs`, `node LiveChat/tests/map-warnings-ui.test.cjs`, and `firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/report-lifecycle.test.mjs"`.

`forums/alertUI.js` owns the independent Leaflet picker and confirmation controls. Run `node LiveChat/tests/alert-ui.test.cjs`, `node LiveChat/tests/forum-ui.test.cjs`, and `firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/alerts.test.mjs"` for the alert checks. They do not publish reports to the live database.

### Discussions

Use the **Chats** and **Forums** buttons at the top of the live chat panel, on either the map or the standalone page. Forums use the same saved name and Firebase sign-in. Anyone signed in can start a discussion or reply. Posts have a title (140 characters), body (5,000 characters), and type: Question, Comment, Concern, or Other. Replies support up to 2,000 characters. Discussion text supports line breaks and is displayed as plain text.

`forums/forumService.js` saves data and subscribes to live updates; `forums/forumUI.js` handles the post list, creation, and replies; `forums/forums.css` styles the forum view. The shared layout is in `mainChat.html`. On mobile, opening a post switches to its detail view; **All posts** returns to the list.

Firestore paths:

- `forums/{postId}`: title, body, category, authorId, name, createdAt, lastActivityAt, replyCount, lastReplyId.
- `forums/{postId}/replies/{replyId}`: body, authorId, name, createdAt.

IDs are generated automatically so duplicate titles are allowed. Ordinary discussion posts do not expire; warning alerts close after 24 hours but retain their history. Each reply and its parent's reply count are saved in one batch. Rules reject unauthenticated access, forged author IDs, invalid text, orphan replies, count tampering, content edits, and deletion. The existing chat Clear button never touches forums. The collection appears in Firebase after the first post.

The newest 50 posts are loaded first; **Load more posts** includes older ones. Search and type filters apply to loaded posts. Threads display the latest 50 replies in chronological order; **Show earlier replies** loads older ones. Failed writes keep the text for retry, and switching posts retains reply drafts. Forum listeners stop when leaving Forums or closing chat.

Test the forum service and rules locally with:

```sh
firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/forums.test.mjs"
```

Open `mainChat.html` through a local web server from the project root (for example VS Code Live Server). Firebase modules cannot load when the page is opened with `file://`.

The first visit asks for a name and signs in with Firebase Anonymous Authentication. Firebase remembers the identity in this browser. Clearing chat does not delete accounts or names.

## Shared messages

All users share `chats/Campus Chat/messages` in the default Firestore database. Each message has an automatically generated document ID and these fields:

- `senderId`: Firebase Authentication UID
- `name`: the sender's display name at send time
- `text`: message text
- `createdAt`: Firestore server timestamp

The screen listens to the latest 100 messages in chronological order. Older messages stay in Firebase. Enter and Send both save messages; a failed send keeps the draft. The old browser-only history is discarded, not uploaded.

Clear asks for confirmation, then deletes every message captured at the start of deletion in batches. New messages arriving afterward are kept. Other connected users see the deletions immediately. If interrupted, Clear can be retried. Only explicitly appointed chat moderators may clear Campus Chat. A reason is required, and every deleted message has an immutable moderation record.

## Groups

The sidebar keeps Campus Chat first, followed by your pinned groups, a divider, and other open groups. Search filters groups by name; Campus Chat stays visible. New chat stays at the bottom. Pins are saved for your Firebase anonymous account and survive refresh in the same browser/origin.

Create a public group to let anyone join, or a private group with a 6–128 character password. Private groups have a subtle gray overlay over their normal colors. Groups stay open until their creator explicitly deletes them; there is no inactivity limit or automatic closing. Existing records with old `idleHours` values remain open regardless of the age of their last message. New records omit that field, and clients cannot add or change it. Message activity timestamps are retained for ordering and history.

Only the group's creator can choose **Delete group** and confirm the action. The data service verifies the creator in a transaction and saves server `deletedAt` plus `deletedBy` on the group document. The group disappears from the chat lists, and security rules revoke access to its messages, member directory, memberships, and requests, including for existing members and moderators. New messages, joins, requests, and decisions are rejected. Campus Chat and direct conversations cannot be deleted this way; moderator status does not grant group deletion rights.

Deletion keeps a permanent tombstone and the protected child records in Firestore. The tombstone's group metadata remains discoverable so connected clients receive the deletion and the name remains reserved. Clients cannot restore the group, remove its deletion fields, change its creator, physically delete the parent document, or recreate a chat with the same name. This prevents retained messages, memberships, or password proofs from resurfacing in a new same-name group. Choose a new unique name for a new conversation.

In the private-group password dialog, Request access sends a pending request to existing members. Members viewing that group see the requester's name and Accept/Deny buttons. Any member may decide; acceptance adds membership and automatically opens the waiting requester's chat. A denial keeps access blocked and permits a new request. Existing members are remembered and need not enter the password again.

All conversations now live under `chats`. Each document ID is its actual chat name, including `Campus Chat`. Names must be unique; duplicate names are rejected instead of overwriting a conversation. Names cannot contain `/`, control characters, or reserved Firestore document names.

Firestore paths:

- `chats/{chatName}`: discoverable name, visibility, creator, timestamps, public password salt, last message ID; deleted groups additionally have immutable `deletedAt` and `deletedBy`.
- `chats/{chatName}/messages`: sender ID, name, text, server timestamp; only current members of open groups may read/write.
- `chats/{chatName}/members/{uid}`: individual membership and admission proof. A user can read only their own membership; membership lists are not public.
- `chats/{chatName}/requests/{uid}`: request and decision; visible to the requester and members of the open group.
- `chats/{chatName}/private/password`: salted PBKDF2-SHA256 verifier (600,000 iterations), unreadable by clients; security rules compare admission proofs. Plain passwords are not saved.
- `chatPreferences/{uid}/pins/{groupId}`: private per-user pins.

`groups.js` handles data and access, `groupPassword.js` derives password proofs, `groupUI.js` handles discovery/forms/pins, and `chat.js` switches message listeners and displays requests. All use the same shared HTML on the standalone page and the map. The password helper uses WebCrypto on localhost/HTTPS, with a pinned `@noble/hashes` module fallback for HTTP LAN previews. Use HTTPS when sharing an actual deployment.

The private password document is nested inside its chat so there is no separate top-level secrets collection. Firestore reads grant access to a whole document, so the verifier must remain in a separate protected document rather than alongside the public chat name.

## Rules and checks

`firestore.rules` protects all chats and their nested password documents while preserving the project's pre-existing test-mode policy elsewhere, which expires October 25, 2026. Message creation requires a matching authenticated UID, a nonblank name/text within length limits, and a server timestamp. Existing messages cannot be edited.

Run from the project root:

```sh
node LiveChat/tests/chat-ui.test.cjs
node LiveChat/tests/group-ui.test.cjs
firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/firestore.test.mjs"
firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/groups.test.mjs"
```

These tests use mocks and a local Firestore emulator; they do not write test messages into the live Campus Chat.

Deploy only these rules when needed:

```sh
firebase deploy --only firestore:rules --project hackathon2026-bfbf3 --config firebase.chat.json
```

## Moderation and trusted roles

- Regular users can send messages. They cannot clear shared history, remove messages, or assign roles.
- Moderators can clear Campus Chat and remove individual Campus messages. They can remove group messages only after joining that still-active group. Group creators do not automatically become moderators. No bulk group clear is exposed.
- Group creators can permanently close their own public/private group through **Delete group**. This saves a tombstone, revokes child-data access, and reserves the name. A moderator cannot delete someone else's group. Group age never changes these permissions.
- Moderators gain no access to other people’s direct messages; moderation actions are disabled for all direct messages.
- Verifiers can approve other users' active warning reports and resolve warnings. Verifier and moderator roles are independent. Neither role grants the other.
- Trusted project administrators grant/revoke roles at users/{uid}/roles/moderator or users/{uid}/roles/verifier with enabled: true/false. Use the exact Firebase UID, never a display-name match at sign-in. All client role writes are denied. Profile edits cannot add roles. Removing a role document also revokes access.
- Removal records at chats/{chatName}/moderation/{messageId} contain action (remove/clear), messageId, actorId, server createdAt and reason. They contain no copy of the removed text, cannot be changed/deleted by clients, and are readable only by moderators with access to that conversation.
- Deletion and its audit record are atomic. Clear captures the current message IDs once, preserving later messages; small batches respect Firestore security-rule access limits. A failed/partially completed Clear reports progress and may be retried. Server rules recheck the role on every commit, including after revocation.
- Browser moderator controls require a role snapshot confirmed by the server. Cached roles alone cannot enable them. Anonymous accounts are browser-specific; using the same name in a different account grants no permissions.

Run the authorization suite with:
```sh
firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/moderation.test.mjs"
```
