# Mobile list slice

The Stage 1 client is an Expo SDK 54 / React Native workspace under `apps/mobile`. It supports the recorded Node 24 and npm 11 toolchain. The mobile package uses the workspace-local `index.ts` entry so Expo registers `App.tsx` correctly even though dependencies are hoisted to the repository root.

From the repository root:

```sh
npm ci
npm run mobile:typecheck
npm run mobile:test
npm run mobile:start
```

`mobile:start` opens the Expo development server for an iPhone simulator or a connected device. The initial screen reads `GET /items?memberId=<member-id>` from the API at `http://127.0.0.1:3000` and refreshes with pull-to-refresh. Configure `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_MEMBER_ID` before starting when using a physical iPhone or a different local Member, for example `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000 EXPO_PUBLIC_MEMBER_ID=member-1 npm run mobile:start`.

The list consumes the backend `MemberListItem` discriminators without changing their meaning:

| Backend entry | Client presentation |
| --- | --- |
| `task` / `open` | Task |
| `task` / `completed` | Completed task |
| `note` / `none` | Note |
| `note` / `needs_review` | Needs review |
| `capture` / `pending` | Processing |
| `capture` / `failed` | Capture failed |

Loading, empty, and request-failure states remain explicit. A failed request retains already displayed items when available and never creates a local Task or Note. Each row uses the backend's stable `kind` and `id` for its React key and passes its `detailUrl` to the optional `onOpenDetail` callback. This callback is the #63 navigation entry-point seam; #66 owns the actual detail/review destination screen and navigation implementation.

## Voice Captures

The list's `Record a Capture` action starts the explicit in-app microphone flow. The client requests microphone permission, records locally with `expo-audio`, and shows recording, ready, submitting, and failed states. `Cancel` or `Discard` removes the unsubmitted recording from the flow; it never creates a server item.

Submitting sends one `POST /captures` request with the Member ID, the `.m4a` audio as base64, its content type, capture timestamp, and a stable idempotency key. A failed upload keeps the local recording and offers `Retry submission`; it does not display server confirmation or invent a Task/Note. Hands-free, background, Siri, and offline-draft capture remain deferred.

The Expo config plugin supplies the iOS microphone permission message. Recording is unavailable in the iOS simulator, so the human review gate must use a physical iPhone.
