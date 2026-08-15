# Mobile list slice

The Stage 1 client is an Expo SDK 54 / React Native workspace under `apps/mobile`. It supports the recorded Node 24 and npm 11 toolchain. The mobile package uses the workspace-local `index.ts` entry so Expo registers `App.tsx` correctly even though dependencies are hoisted to the repository root.

From the repository root:

```sh
npm ci
npm run mobile:typecheck
npm run mobile:test
npm run mobile:start
npm run dev:all
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

Needs review Notes remain Notes: the list labels them explicitly and opens the detailed review so the Member can confirm or edit the result. The review distinguishes ambiguous from unsupported instructions when that classification is present. Failed Captures remain visible as failed Captures and open detailed review with the failure and original Capture context; the client does not silently retry processing. Pending Captures remain Processing until the server reports a result; none of these states is presented as a Task.

## Voice Captures

The list's `Record a Capture` action starts the explicit in-app microphone flow. The client requests microphone permission, records locally with `expo-audio`, and shows recording, ready, submitting, and failed states. `Cancel` or `Discard` removes the unsubmitted recording from the flow; it never creates a server item.

Submitting sends one `POST /captures` request with the Member ID, the `.m4a` audio as base64, its content type, capture timestamp, and a stable idempotency key. A failed upload keeps the local recording and offers `Retry submission`; it does not display server confirmation or invent a Task/Note. Hands-free, background, Siri, and offline-draft capture remain deferred.

After the server accepts a Capture, the client polls `GET /items` for that Capture's stable ID. The screen shows `Processing your Capture…` while the result is pending, then shows exactly one Task or Note in a result-first preview. The 15-second unattended-save window starts only when that result exists; `Save` or expiry is idempotent, and duplicate or stale list responses cannot restart the timer. A failed processing state remains visible and keeps the original Capture available for review.

If the server does not produce a result within 30 seconds, polling stops and the screen reports that processing has not been confirmed; the original Capture remains stored on the server. A detailed review opens from an item row. It keeps source/provenance text separate from editable Task or Note fields; fields become inputs only after focus. Open Tasks can be edited with Save or completed with the server-confirmed `POST /tasks/<task-id>/complete` mutation; each action carries the current optimistic-concurrency version, blocks duplicate in-flight taps, and keeps the review visible with a retry after failure. Completed Tasks remain readable and are not editable. Notes use an explicit Save action from detailed review: editable Note content is shown separately from the read-only original transcription and source identifiers. A failed Note save keeps both the edited draft and provenance visible for retry, and duplicate taps while a save is in flight are ignored. This timeout prevents an unconfigured or unavailable processing provider from appearing as an endless successful load. The Expo config plugin supplies the iOS microphone permission message. Recording is unavailable in the iOS simulator, so the human review gate must use a physical iPhone.

To inspect the review UI before a local processing provider is configured, start Expo with `EXPO_PUBLIC_REVIEW_FIXTURE=task npm run mobile:start` or `EXPO_PUBLIC_REVIEW_FIXTURE=note npm run mobile:start`. This is an in-memory development fixture only; it does not create API data or change Capture processing.

## Starting the API and Expo together

Use `npm run dev:all` for an iPhone simulator or a Mac-local workflow. It starts the API and Expo together and points the mobile app at `http://127.0.0.1:3000`.

For a physical iPhone on the same Wi-Fi network, use:

```sh
npm run dev:all -- --lan
```

The helper selects the Mac's non-loopback IPv4 address, binds the API to `0.0.0.0`, and passes the matching URL to Expo. If the Mac has multiple network adapters or automatic detection chooses the wrong one, set the address explicitly:

```sh
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000 npm run dev:all -- --lan
```

The phone must be able to reach that address, both devices must be on the same network, and macOS firewall rules must allow the API port. `npm run dev:all` does not guess a LAN address unless `--lan` is supplied.

For the current Mac network (`192.168.34.9/24`), the explicit separate-terminal setup is:

Terminal 1 — backend:

```sh
API_HOST=0.0.0.0 API_PORT=3000 npm run dev
```

Terminal 2 — Expo:

```sh
EXPO_PUBLIC_API_BASE_URL=http://192.168.34.9:3000 EXPO_PUBLIC_MEMBER_ID=member-1 npm run mobile:start -- --lan
```

The iPhone should use the same Wi-Fi network. Verify backend reachability from the phone with `http://192.168.34.9:3000/health`; if it is unreachable, allow incoming connections for Node in the macOS firewall.
