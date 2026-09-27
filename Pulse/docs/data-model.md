# Pulse data model — schema 2 (Spark)

All feature records live under one expandable campus root:

    pulse/mmc
      spots/{spotId}
      availability/{uid}
      proposals/{proposalId}
        messages/{messageId}
        checkIns/{uid}

The campus document contains enabled, demoMode, displayName, bounds, schemaVersion and backend. Campus and spot writes require administrator access. Students only read them.

## Availability

One current ticket per Firebase UID. Fields: uid, displayName, requestId, version, activities, walks, status, proposalId, createdAt, updatedAt and expiresAt.

walks maps reachable spot IDs to integer estimated walking minutes. No latitude, longitude, starting-place ID or GPS trace is uploaded. A waiting ticket is discoverable by authenticated users through a bounded query. Reserved tickets are readable only by their owner and the candidates of their proposal. Closed tickets are not discoverable through the matching query.

Only the owner can start or close availability. Another candidate can reserve a waiting ticket only as part of a valid atomic proposal. Owners cannot replace a still-active accepted/reserved ticket.

## Proposals and meetups

A proposal contains candidateIds, participantNames, availabilityVersions, spotId and spot snapshot, activity, walkingMinutes, startsAt, endsAt, responseDeadline, responses, participantIds, departedIds and lifecycle timestamps.

Its status moves from pending to confirmed or expired. Confirmed proposals are the meetup; there is no duplicate meetups collection. The same proposal ID identifies the chat throughout its lifetime. The browser derives each user's current screen from their ticket and proposal rather than storing a second memberState document.

Candidates can read the proposal. Each candidate can respond only for themselves. After everyone answers or time expires, a candidate can request settlement; rules derive the accepted members independently. Rejected and late candidates cannot read or write chat or check-ins. Departed members immediately lose those permissions.

Responses and the original plan cannot be rewritten after confirmation. Users may leave only for themselves. Two members must remain for chat and check-in access.

## Messages and check-ins

Messages have exactly senderId, text and createdAt. Rules require the authenticated sender, current membership, nonblank text of at most 2,000 characters, a server timestamp and an open chat window.

Check-ins have exactly uid, method and checkedInAt. Only the currently accepted user can create their own check-in before the meetup ends. Repeated calls return the saved result. GPS is evaluated on the phone and never stored.

## Expiry and retention

Chat closes ten minutes after the planned end. Active actions and late responses are rejected using server time. Stored data is not automatically erased by a timer. The explicit administrator maintenance script deletes expired nested data and parents; deleteAfter is an eligibility timestamp, not a paid TTL policy.

Additional campuses get their own root document. Additional spots are separate documents. The current demo matcher scans at most 100 waiting tickets, supports up to 50 reachable spots per ticket and groups of 2–4. Expansion beyond that needs queue partitioning and load testing.
