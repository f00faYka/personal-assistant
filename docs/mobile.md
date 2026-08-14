# Mobile list slice

The Stage 1 client is an Expo SDK 54 / React Native workspace under `apps/mobile`. It supports the recorded Node 24 and npm 11 toolchain.

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

Loading, empty, and request-failure states remain explicit. A failed request retains already displayed items when available and never creates a local Task or Note. Each row uses the backend's stable `kind` and `id` for its React key and passes its `detailUrl` to the optional `onOpenDetail` callback. Review navigation and Capture submission belong to later tickets.
