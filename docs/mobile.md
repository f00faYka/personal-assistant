# Mobile list slice

The Stage 1 client is an Expo SDK 58 / React Native 0.88 workspace under `apps/mobile`. It supports the recorded Node 24 and npm 11 toolchain. The mobile package uses the workspace-local `index.ts` entry so Expo registers `App.tsx` correctly even though dependencies are hoisted to the repository root. SDK 58 requires iOS 16.4 or later and Xcode 26.4 for native iOS builds.

From the repository root:

```sh
npm ci
npm run mobile:typecheck
npm run mobile:test
npm run mobile:start
npm run dev:all
```

`mobile:start` opens the Expo development server for an iPhone simulator or a connected device. The initial screen reads `GET /items?memberId=<member-id>` from the API at `http://127.0.0.1:3000` and refreshes with pull-to-refresh. Configure `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_MEMBER_ID` before starting when using a physical iPhone or a different local Member, for example `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000 EXPO_PUBLIC_MEMBER_ID=member-1 npm run mobile:start`.

To inspect the real product in a desktop browser, run `npm run mobile:web` from the repository root. To inspect the shared mobile shell with deterministic fixture data, run `npm run mobile:web:fixture`. The browser preview mounts the same `AppShell` navigation and shared screen tree as the native entry point; browser adapters provide synthetic data and substitute native capabilities. Reload the browser page to reset the fixture; it is an in-memory UI preview and cannot modify production data or the API database. Run `npm run mobile:test` to verify the shared navigation and fixture behavior. This is a UI-only preview and does not replace the native iOS entry point.

To open the same fixture preview on an iOS simulator or connected iPhone, run `npm run mobile:fixture`. This sets `EXPO_PUBLIC_UI_FIXTURE=true` for that Expo session and routes the native entry through `BrowserPreview`; ordinary `npm run mobile:start` remains the real product. Do not use the fixture command for a production build.

The list consumes the backend `MemberListItem` discriminators without changing their meaning:

| Backend entry | Client presentation |
| --- | --- |
| `task` / `open` | Task |
| `task` / `completed` | Completed task |
| `note` / `none` | Note |
| `note` / `needs_review` | Needs review |
| `capture` / `pending` | Processing |
| `capture` / `failed` | Capture failed |

Loading, empty, and request-failure states remain explicit. A failed initial or refresh request retains already displayed items when available and never creates a local Task or Note. If a later cursor page fails, the loaded rows remain in place and the list footer identifies the pagination failure and retries that same cursor. A recovered page is appended by stable item ID, so retrying cannot duplicate an in-flight page or an existing row. Each row uses the backend's stable `kind` and `id` for its React key and passes its `detailUrl` to the optional `onOpenDetail` callback. This callback is the #63 navigation entry-point seam; #66 owns the actual detail/review destination screen and navigation implementation.

Needs review Notes remain Notes: the list labels them explicitly and opens the detailed review so the Member can confirm or edit the result. The review distinguishes ambiguous from unsupported instructions when that classification is present. Failed Captures remain visible as failed Captures and open detailed review with the failure and original Capture context; the client does not silently retry processing. Pending Captures remain Processing until the server reports a result; none of these states is presented as a Task.

## Voice Captures

The primary-navigation microphone opens the shared bottom Capture drawer from any screen. The client requests microphone permission, records locally with `expo-audio`, and shows recording, ready, submitting, and failed states in that drawer. After submission is accepted, the drawer stays open with a processing message, then switches to the Task or Note result when its 15-second timer starts. `Cancel` or `Discard` removes the unsubmitted recording from the flow; it never creates a server item.

Submitting sends one `POST /captures` request with the Member ID, the `.m4a` audio as base64, its content type, capture timestamp, and a stable idempotency key. When local Offline draft storage is unavailable, a failed upload keeps the recording in the Capture drawer and offers `Retry submission`; it does not display server confirmation or invent a Task/Note. Hands-free, background, and Siri capture remain deferred.

## Offline drafts

When the backend cannot confirm a voice-Capture submission, the client copies the recording into the app document directory and records its stable draft ID, Member ID, capture time, content type, and managed file location in a local manifest. Manifest replacements are staged before promotion and retain the last durable manifest as a recovery copy, so an interrupted write cannot overwrite every previously saved draft. This storage survives an ordinary app restart and is private to the app sandbox; it is not separately encrypted by the client. If the backend cannot save changed Note text from detailed review, the client preserves that explicitly entered text in the same store and labels the save as an unconfirmed Offline draft. Confirmed non-retryable client errors such as validation failures, authorization failures, and optimistic-concurrency conflicts remain normal request failures rather than drafts waiting to synchronize; timeouts and rate limits remain eligible for durable recovery. The client does not classify Offline-draft text as a Task or Note, and there is no standalone typed-capture entry point.

Restored drafts appear in the timeline as `Offline draft` with `Not confirmed · Waiting to synchronize`. They remain non-interactive as server items and never open review or claim that processing has begun. Multiple drafts are preserved independently and only drafts belonging to the current Member are shown. A backend list failure does not hide restored drafts.

The client reports corrupt local metadata, audio-copy failures, and manifest-write failures. If a failed upload cannot be saved durably, the recording remains in the failed submission panel and the UI says that the Offline draft was not saved. It never displays an unconfirmed card for that failure.

An Offline draft and its managed audio are removed only when the Member uses `Delete draft`. Audio deletion derives the managed filename from the draft identity instead of trusting a stored file URI. The file is first moved to a managed staged-deletion name, the manifest removal is committed, and only then is the staged file deleted; startup reconciliation restores or finishes an interrupted deletion according to the durable manifest. The client does not retry, synchronize, classify, or silently delete drafts in this ticket. Synchronization progress, retry policy, server confirmation, and replacement with a normal Task/Note result belong to the later Stage 2 synchronization slice. Offline Task editing, completion, and conflict resolution remain out of scope.

After the server accepts a Capture, the client polls `GET /items` for that Capture's stable ID. The screen shows `Processing your Capture…` while the result is pending, then shows exactly one Task or Note in a result-first preview. The 15-second unattended-save window starts only when that result exists; `Save` or expiry is idempotent, and duplicate or stale list responses cannot restart the timer. A failed processing state remains visible and keeps the original Capture available for review.

Task review presents optional due information as `Remind At:` with separate date and time controls. The date editor uses a calendar and the time editor accepts 24-hour values; either value can be changed or cleared, and invalid values remain unsaved with validation feedback. This is display/edit metadata only: Stage 1 does not request notification permission, create Reminder records, schedule delivery, or imply that a notification will be sent.

The Task detail due editor uses the same draft flow for real and fixture data. On iOS, tapping the date opens the system inline calendar; tapping the time opens the system wheels (`@react-native-community/datetimepicker`). Web uses browser date/time inputs. Values display in the device's local timezone and persist as UTC instants. Selecting a date or time applies it immediately to the draft; tapping the active field again closes that picker. **Save changes** persists the task. Clear applies immediately. Invalid dates, invalid 24-hour times, and nonexistent local times during a daylight-saving transition cannot be applied.

For native acceptance, open a Task on a narrow iPhone and verify that all seven weekday columns and both month arrows are visible and tappable. Change months, select a date, tap the date field again, switch to time, scroll both wheels, and tap the time field again. Then use Save changes and Clear. Also add a deadline to an undated Task. The native picker is fitted to the available card width using its measured size; unit tests cover the calculation, but native rendering and touch targets still require device verification.

If the server does not produce a result within 30 seconds, polling stops and the screen reports that processing has not been confirmed; the original Capture remains stored on the server. A detailed review opens from an item row. It keeps source/provenance text separate from editable Task or Note fields; fields become inputs only after focus. Open Tasks can be edited with Save or completed with the server-confirmed `POST /tasks/<task-id>/complete` mutation; each action carries the current optimistic-concurrency version, blocks duplicate in-flight taps, and keeps the review visible with a retry after failure. Completed Tasks remain readable and are not editable. Notes use an explicit Save action from detailed review: editable Note content is shown separately from the read-only original transcription and source identifiers. A failed Note save keeps both the edited draft and provenance visible for retry, and duplicate taps while a save is in flight are ignored.

A saved ordinary or Needs review Note exposes an explicit `Convert saved Note to Task` action. The server-confirmed `POST /notes/<note-id>/convert-to-task` mutation replaces the displayed Note with an open Task while retaining the same durable item identity and provenance; returning to the list performs a fresh read, so no Note/Task duplicate is displayed. Conversion requires a backend connection and is never queued as an Offline draft. Duplicate taps are ignored while conversion is in flight. A confirmed failure keeps the Note, review state, and provenance visible and refreshes the optimistic-concurrency version before retry.

The Stage 2 state-to-surface mapping is consistent across the list, result preview, and detailed review:

| State | List | Preview/review | Recovery action |
| --- | --- | --- | --- |
| Pending or processing | Processing your Capture | Processing; no result is implied | Refresh or wait for the server |
| Confirmed Task | Task or Completed task | Task fields and provenance | Edit or complete when the Task is open |
| Confirmed Note | Note or Needs review | Note fields and provenance | Review, save, or explicitly convert a saved Note |
| Retryable synchronization failure | Offline draft, not confirmed | Original draft remains available | Retry synchronization |
| Failed processing | Capture failed | Failure and original Capture remain visible | Inspect review and retry when processing is available |

When a stale Note review receives a concurrency failure, the client refreshes the review before offering another action. If the server has converted that Note to a Task, the client switches to Task fields and labels the refresh; it never reports the stale Note edit as saved.

The processing timeout prevents an unconfigured or unavailable provider from appearing as an endless successful load. The Expo config plugin supplies the iOS microphone permission message. Recording is unavailable in the iOS simulator, so the human review gate must use a physical iPhone.

While recording, the mobile client enables `expo-audio` metering and maps the recorder's bounded dB level to bounded waveform bars. Silence stays at the minimum bar height and louder microphone input increases the bars. If metering is unavailable, the client shows a quiet fallback waveform and says that recording continues; recorder interruption is shown explicitly while leaving Finish recording available. The waveform is visual-only and does not change the recorded audio or submission contract.

To inspect the review UI before a local processing provider is configured, start Expo with `EXPO_PUBLIC_REVIEW_FIXTURE=task npm run mobile:start` or `EXPO_PUBLIC_REVIEW_FIXTURE=note npm run mobile:start`. This is an in-memory development fixture only; it does not create API data or change Capture processing.

## Starting the API and Expo together

Use `npm run dev:all` for the complete local workflow. It reads and validates `.env`, reuses ready Ollama/Whisper services, starts missing local services, checks the configured Ollama model, waits for both runtimes, and only then starts the API and Expo. On Ctrl+C it terminates only processes started by this command.

Copy `.env.example` to `.env` and replace the reviewed model names and machine-specific paths. The routine requires `OLLAMA_ENDPOINT`, `OLLAMA_HEALTH_ENDPOINT`, `OLLAMA_MODEL`, `OLLAMA_BINARY_PATH`, `WHISPER_ENDPOINT`, `WHISPER_HEALTH_ENDPOINT`, `WHISPER_BINARY_PATH`, `WHISPER_MODEL_PATH`, and `EXPO_PUBLIC_API_BASE_URL`. It never downloads binaries or models. A missing path, unavailable model, startup failure, or readiness timeout is reported with the variable and the next operator action.

When the command is run from Herdr, it detects `HERDR_ENV=1`, uses the current workspace's `run` tab, and keeps API, Expo, and any newly started local runtime visible in separate panes. Stop the launcher with Ctrl+C; existing panes and reused services remain running.

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
