# Campus Chat

Open `mainChat.html` through a local web server from the project root (for example VS Code Live Server). Firebase modules cannot load when the page is opened with `file://`.

The first visit asks for a name and signs in with Firebase Anonymous Authentication. Firebase remembers the identity in this browser. Clearing chat does not delete accounts or names.

## Shared messages

All users share `chats/campus-public/messages` in the default Firestore database. Each message has an automatically generated document ID and these fields:

- `senderId`: Firebase Authentication UID
- `name`: the sender's display name at send time
- `text`: message text
- `createdAt`: Firestore server timestamp

The screen listens to the latest 100 messages in chronological order. Older messages stay in Firebase. Enter and Send both save messages; a failed send keeps the draft. The old browser-only history is discarded, not uploaded.

Clear asks for confirmation, then deletes every message captured at the start of deletion in batches. New messages arriving afterward are kept. Other connected users see the deletions immediately. If interrupted, Clear can be retried. Any signed-in participant can clear this hackathon chat, as requested; this permission is specific to Campus Chat.

## Rules and checks

`firestore.rules` protects Campus Chat while preserving the project's pre-existing test-mode policy elsewhere, which expires October 25, 2026. Message creation requires a matching authenticated UID, a nonblank name/text within length limits, and a server timestamp. Existing messages cannot be edited.

Run from the project root:

```sh
node LiveChat/tests/chat-ui.test.cjs
firebase emulators:exec --only firestore --project demo-fiu-chat --config firebase.chat.json "node LiveChat/tests/firestore.test.mjs"
```

These tests use mocks and a local Firestore emulator; they do not write test messages into the live Campus Chat.

Deploy only these rules when needed:

```sh
firebase deploy --only firestore:rules --project hackathon2026-bfbf3 --config firebase.chat.json
```
