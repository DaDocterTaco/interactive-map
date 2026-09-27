# Pulse data model

Status: backend and combined permission rules implemented and emulator-tested. No production database records or permissions have been deployed. See [backend-setup.md](backend-setup.md) for current implementation limits and validation.

## One expandable Pulse area

Firestore alternates collections and documents. In the console, open the `pulse` collection and its `mmc` campus document, then the relevant subcollection. These are database records, not filesystem folders.

```text
pulse/                                  collection
  mmc/                                  campus document
    spots/{spotId}                      catalog of meeting spots
    availability/{uid}                  private active availability and matching input
    memberState/{uid}                   private current proposal/meetup pointer
    proposals/{proposalId}              one shared invitation and responses
    meetups/{meetupId}                   one confirmed plan and accepted participant IDs
      messages/{messageId}              that meetup's only chat history
      checkIns/{uid}                    one arrival record per accepted participant
```

`users/{uid}` remains the existing shared profile directory. Account credentials and sign-in remain in Firebase Authentication. Existing Campus Chat, groups, and direct conversations retain their existing paths; they are not moved into Pulse.

## Record responsibilities

| Record | Main information | Who may read it |
| --- | --- | --- |
| Campus | Display name, enabled flag, schema version, allowed activities and demo settings | Signed-in app users; configuration writes restricted to trusted administration |
| Spot | Stable ID, name, exact meeting instruction, coordinates, supported activity IDs, enabled flag, verification status and source | Signed-in app users |
| Availability | User ID, selected activities, opt-in time, absolute expiry, walking limit, and only the latest location input needed to match | Its owner and the trusted matching backend |
| Member state | User ID, active availability version, proposal ID or meetup ID, and update time | Its owner and backend |
| Proposal | Candidate IDs, shared activity and spot, proposed start/end, response deadline, per-person walk estimates, response map, status | Invited users and backend; no precise starting locations copied here |
| Meetup | Accepted participant IDs, activity, spot ID and meeting-detail snapshot, confirmed start/end, chat closing time, lifecycle status, optional cancellation reason | Authorized participants and backend |
| Message | Sender ID, text, and server creation time; optional display-name snapshot for historical display | Authorized participants while chat access is valid |
| Check-in | Participant ID, manual/automatic method, server check-in time | Authorized participants and backend |

The response map and participant arrays are deliberately bounded to the demo's two-to-four-person groups. Messages and meetup history grow as separate documents, not arrays on the campus or meetup document. Location details stored on availability must not be copied into proposals, messages, public profiles, or ordinary logs.

The proposal can store a snapshot of the meeting instruction and spot coordinates so all recipients see the same offer. The confirmed meetup retains its final snapshot so editing a catalog spot cannot silently change an already-agreed destination. This is an intentional historical snapshot, not another independently maintained catalog.

## Single ownership and reliable transitions

- Store stable user IDs, spot IDs, proposal IDs, and meetup IDs. Display names and location labels are not unique keys.
- Let the backend validate opt-in, responses, confirmation, leaving, cancellation, and check-in. Never accept a caller-supplied user ID as authentication.
- Atomically reserve candidate member-state records when creating a proposal. Concurrent requests must not place one user into multiple active proposals or overlapping confirmed meetups.
- Atomically confirm accepted membership, update member-state pointers, and create the meetup. Use a deterministic relationship between the proposal ID and meetup ID so retrying confirmation cannot create another meetup or chat.
- Store chat messages only at `pulse/mmc/meetups/{meetupId}/messages/{messageId}`. Derive the chat destination from the meetup path; adapt the existing message service/UI to accept this reference. Do not duplicate messages under `chats`.
- Server-created proposal responses cannot be forged or changed on behalf of another participant. Declined and unanswered users never receive meetup-chat membership.
- Member-state pointers support refresh and reconnection. They are maintained in the same transactions as the authoritative proposal/meetup transitions.
- All operations revalidate membership, expiry, timing constraints, and any existing commitment. UI countdowns do not enforce database correctness.
- Server SDK operations bypass Firestore client rules, so backend code must independently enforce authorization and invariants.

## Privacy and access boundaries

Firestore reads return entire documents. Fields that different users may access must be split across documents with appropriate permissions. Availability is owner-only because it includes private matching location input; the shared proposal carries only the public meeting point and derived estimates.

All Pulse collections must be excluded from the existing unrelated-data fallback and covered by explicit rules. Nested message and check-in collections also need explicit rules. Moving records under a parent does not automatically create access control.

Participants can send chat messages only while authorized and before the chat closing time. Client rules verify sender identity, allowed fields, text limits, and server timestamps. Presence, acceptance, and check-in changes use authenticated backend operations. Leaving revokes further chat access; if fewer than two participants remain, cancel the group plan and inform the remaining participant.

For automatic arrival, keep continuous location readings in device memory. Send only the limited fresh fixes needed for a check-in validation operation, and persist the arrival result instead of a trail of coordinates. Location readings are participant-provided signals and are not proof of physical presence.

## Expiration and cleanup

Availability expiry, proposal deadline, meetup end, and chat closing time are separate server timestamps. Use them to reject expired actions immediately, even if cleanup has not run.

Clear matching location inputs when availability is canceled, declined, consumed by confirmation, or a proposal expires. The implemented cleanup function runs every minute when deployed and removes expired availability; action handlers also enforce expiration immediately. This scheduled function has not been deployed.

End active meetups at their scheduled time. The implemented chat grace period is 10 minutes. Closed meetup data and its nested messages/check-ins are deleted after 24 hours; proposals have a 24-hour retention deadline. These durations live in `shared/policy.js` and must be communicated by the Pulse interface before acceptance.

Deleting or applying TTL to a parent Firestore document does not delete nested messages or check-ins. Cleanup must handle those subcollections explicitly. Database cleanup is separate from immediately enforcing expiry and membership.

## Expansion

- Add another coffee or chat location by adding a verified, enabled spot document with existing activity IDs.
- Add an activity through the supported activity configuration and validation/UI options.
- Add another campus under `pulse/{anotherCampusId}` using the same collection structure; all query paths and access rules use the campus ID.
- Centralize database path creation in one module and include schema versions for controlled migrations.
- Document required queries and deploy their indexes with the app, based on the matching implementation. Avoid broad collection-group queries when a campus-scoped query is sufficient.

## References

- [Firestore data model](https://firebase.google.com/docs/firestore/data-model)
- [Choosing a data structure](https://firebase.google.com/docs/firestore/manage-data/structure-data)
- [Protecting fields with separate documents](https://firebase.google.com/docs/firestore/security/rules-fields)
- [Transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
