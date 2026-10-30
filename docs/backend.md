# Backend foundation

The MVP backend is an npm-managed strict-TypeScript workspace under `apps/api`. It requires Node.js 24 LTS and npm 11 or later. With nvm, run `nvm use` from the repository root to select the recorded major version.

## Setup and commands

From the repository root:

```sh
npm ci
npm run typecheck
npm run test:health
npm run test:migrations
npm run test:blobs
npm test
npm run build
npm start
```

`npm run dev` starts the API directly from TypeScript during local development. `npm start` runs the compiled output produced by `npm run build`. The API listens on `127.0.0.1:3000` by default; `GET /health` returns `{"status":"ok"}`.

## Configuration and local data

The process optionally loads `.env` and then validates these values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_HOST` | `127.0.0.1` | HTTP listen address |
| `API_PORT` | `3000` | HTTP listen port |
| `API_DATABASE_PATH` | `local-data/api.sqlite` | SQLite database file |
| `API_BLOB_ROOT` | `local-data/blobs` | Filesystem blob root |
| `WHISPER_ENDPOINT` | `http://127.0.0.1:8080/inference` | Local `whisper.cpp` inference endpoint |
| `WHISPER_MODEL` | `ggml-small` | Multilingual model identifier recorded with successful transcriptions; use a model without the `.en` suffix |
| `WHISPER_TIMEOUT_MS` | `120000` | Per-attempt local Whisper timeout, from 1 second to 10 minutes |
| `TRANSCRIPTION_MAX_ATTEMPTS` | `3` | Durable attempt cap, from 1 to 10 |
| `OLLAMA_ENDPOINT` | `http://127.0.0.1:11434/api/chat` | Local Ollama chat endpoint |
| `OLLAMA_MODEL` | supplied by Runtime Manager in `dev:all` | Model sent to Ollama and recorded in interpretation provenance; required for standalone API startup |
| `OLLAMA_TIMEOUT_MS` | `120000` | Per-attempt local Ollama timeout, from 1 second to 10 minutes |
| `INTERPRETATION_MAX_ATTEMPTS` | `3` | Durable interpretation attempt cap, from 1 to 10 |

Copy `.env.example` to `.env` to override the defaults. `.env`, SQLite files, `local-data/`, generated output, and other runtime-data directories are excluded from version control.

## Local AI runtime manager

### Supervised local development

The development-only `npm run dev:all` command uses the separately installed macOS `ai-runtime-manager` CLI to manage Whisper and Ollama. The manager reads `~/Library/Application Support/ai-runtime-manager/config.toml`; Personal Assistant does not edit that file or choose the Ollama model. Keep the API's Whisper and Ollama endpoint variables in `.env` aligned with the manager. The launcher takes the Ollama model reported by manager status and passes it to the API as `OLLAMA_MODEL`; the API continues to call Ollama directly and records that model in provenance.

From a terminal, validate and inspect the manager, then start the app:

```sh
export PATH="$HOME/.local/bin:$PATH"
ai-runtime-manager config validate
ai-runtime-manager status
npm run dev:all
```

The launcher validates the manager configuration, reads `status --json`, takes the selected model from the Ollama runtime record, asks the manager to start enabled unavailable runtimes, then independently checks the configured Whisper health URL and Ollama tags URL for that manager-selected model before starting API and Expo. It does not select or download models, or load an Ollama model itself. If `OLLAMA_MODEL` is set in a local `.env`, `dev:all` overrides it with the manager's selection. If the CLI is not on `PATH`, the launcher also checks `~/.local/bin/ai-runtime-manager`; set `AI_RUNTIME_MANAGER_PATH` only when it is installed elsewhere.

Runtime states have these meanings:

- `managed`: the manager verified that it started the process. Personal Assistant uses it and does not stop it when the app exits.
- `reused`: the manager verified a compatible existing process/model. Personal Assistant uses it and does not stop it.
- `unavailable`: the endpoint/runtime is not ready. `dev:all` asks the manager to start it, then checks readiness. If it remains unavailable, the launcher reports `ai-runtime-manager status` and the expected endpoint; the operator must resolve missing binaries/models or configuration.
- `conflict` (or `failed`): the manager cannot safely use/start the endpoint, including an occupied port, unknown process ownership, or an Ollama model mismatch/not loaded. The launcher stops before API/Expo and tells the operator to resolve it manually. It never kills the process, edits manager configuration, or downloads/loads a model.

The direct post-manager checks are intentional: they confirm the API's `.env` endpoints are reachable and the manager-selected model is available through that Ollama endpoint. Shutdown cleans up only API/Expo processes or Herdr panes created by this launcher. Manager-owned and reused runtimes are left to the manager/operator.

When launched from Herdr (`HERDR_ENV=1`), the command targets the `run` tab in the current workspace. It reuses labelled `personal-assistant API` and `personal-assistant Expo` panes, creates panes for missing app processes, and keeps the launcher alive so Ctrl+C sends an interrupt only to panes created by this invocation. It does not create Whisper, Ollama, or Ollama monitor panes.

The current interpretation provider intentionally remains a direct HTTP adapter. The SDK evaluation found no concrete benefit for this boundary: the adapter already owns the small request/response contract, timeout, structured-output format, safe-error translation, and configured model provenance. Adding an SDK would add dependency and lifecycle coupling without changing those contracts, so no SDK is adopted in this prototype.

The production API expects the owner-operated [`whisper.cpp` HTTP server](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server) to be running before a voice Capture is submitted. Build `whisper-server`, download a compatible model, install `ffmpeg`, and start the server with conversion enabled so iPhone formats such as M4A are accepted. A default-compatible command from the `whisper.cpp` checkout is:

```sh
./build/bin/whisper-server -m models/ggml-small.bin --language auto --host 127.0.0.1 --port 8080 --convert
```

Use a multilingual Whisper model without the `.en` suffix; English-only models can force non-English speech into an English transcription path. `--language auto` enables language detection, and the server must not be started with `--translate`, because the product preserves the speaker's original language. Keep the server bound to localhost and do not run it with administrative privileges. Set `WHISPER_ENDPOINT` if its host, port, request prefix, or inference path differs. Set `WHISPER_MODEL` to the identifier operators should see in transcription provenance; the API records this configured value and does not load or replace the server's model.

API startup creates one serial transcription worker before accepting requests. It first discovers any stored Captures that predate this runtime wiring and creates their missing transcription records. After new immutable Capture audio is stored, both direct Capture submission and audio Offline-draft synchronization create or discover the Capture's one durable transcription record, then queue it without waiting for inference to finish. The worker sends the original bytes as multipart field `file`, requests `response_format=json`, and stores the returned text separately with `provider: whisper.cpp` and the configured model identifier.

Each queue delivery performs at most one provider attempt. Startup recovers durable `pending`, interrupted `processing`, and `failed` records whose attempt count remains below `TRANSCRIPTION_MAX_ATTEMPTS`; an idempotent repeat of the original Capture submission can also redeliver the same job. A provider failure leaves the Capture and original audio unchanged, records a safe `failed` transcription, and increments its attempt count. If the process was interrupted during the final permitted attempt, startup records that interruption as failed without making another provider call. Once the cap is reached, automatic startup/delivery recovery leaves the transcription failed for operator review instead of retrying forever. `GET /captures/<capture-id>/review` and `GET /items` expose the existing failed state; provider response bodies are not stored in the client-visible failure message.

The transcription layer remains provider-neutral and does not classify content or materialize an item. After it stores a successful transcription, it hands the durable record to the separate interpretation worker described below. This preserves the provider boundary completed in issue #98 without adding a hosted fallback or changing Capture/source immutability.

After InterpretationWorker materializes or rediscovers a durable Task or Note, it enqueues organization-proposal generation and returns without waiting for the model. A separate durable worker uses the saved outcome, original transcription, and the owning Member's active Spaces, Tags, and Entities as context. It calls the configured local Ollama model, validates targets against that context, and persists only candidates and short provenance labels through OrganizationProposalService; it never stores chain-of-thought or creates a Space. New Tag and Entity candidates remain temporary until accepted. Existing high-confidence candidates retain #124's automatic assignment behavior, medium candidates remain pending, and low-confidence candidates cannot be accepted.

The current Space and Entity records do not persist descriptions or aliases. Context therefore includes Space paths/names and up to three short examples from items already assigned to each Space, plus Tag and Entity names. Adding editable descriptions or Entity aliases requires a separate domain/API change and is outside this generation ticket.

`GET /items/<item-id>/organization-proposals?memberId=<member-id>&itemKind=task|note` keeps the existing `proposals` array and adds a typed `generation` result. `pending` and `running` mean generation has not finished; `completed_empty` means generation succeeded with no candidates; `ready` includes persisted proposals; and `failed` includes a client-safe `error` and `retryable` flag. The Task/Note and provenance remain available through `GET /items` and detailed review throughout generation and failure. Retry a retryable job with `POST /items/<item-id>/organization-proposals/retry` and `{ "memberId": "...", "itemKind": "task" }`. Generation jobs are idempotent per Member/item, recover pending or interrupted work on startup, and use the existing proposal idempotency key so redelivery cannot create duplicate proposals. This status addition is the backend handoff for the #169 consumer; it does not change its UI.

## Local Ollama runtime

The API connects to a local [Ollama](https://docs.ollama.com/) process. In `dev:all`, the model is selected in AI Runtime Manager configuration; operators install that model separately. Personal Assistant neither selects nor downloads it. For a standalone API process, provide `OLLAMA_MODEL` explicitly. Set `OLLAMA_ENDPOINT` when the local `/api/chat` address differs. The adapter sends a non-streaming chat request with temperature zero and the approved Direct-instruction JSON schema in Ollama's [`format` field](https://docs.ollama.com/capabilities/structured-outputs). It records the supplied model and parsed raw structured output with the resulting Interpretation. HTTP failures, timeouts, invalid API responses, and invalid structured JSON are translated to safe errors without retaining provider response bodies.

The serial interpretation worker starts before transcription recovery. It discovers succeeded transcriptions that have no interpretation job, accepts newly succeeded transcriptions, and durably moves each job through `pending`, `processing`, `succeeded`, or `failed`. One provider attempt may create or rediscover one versioned Interpretation, then idempotently materialize its existing outcome contract: a clear `create_task` creates one Task, ordinary content creates one Note, and ambiguous or unsupported content creates one `Needs review` Note. Interpretation and outcome uniqueness prevent duplicate durable results across redelivery or restart.

Each queue delivery performs at most one interpretation attempt. Startup retries `pending`, interrupted `processing`, and retryable `failed` jobs below `INTERPRETATION_MAX_ATTEMPTS`; an idempotent repeat of the original Capture submission also redelivers its already-succeeded transcription without running Whisper again. When an interruption occurs after the Interpretation is durable, startup materializes or rediscovers its outcome and completes the job without another provider call, including after the final permitted provider attempt. A final interrupted attempt with no durable Interpretation becomes non-retryable instead. A provider failure preserves the Capture and succeeded transcription, stores only the safe failure message, and exposes the attempt count and retryable flag in detailed review. `GET /items` shows the Capture as failed until a later retry succeeds. Deterministic interpretation extracts supported English and Russian relative dates, English and Russian weekdays, word-number clock hours through 23, all word-number minutes from 0 through 59, and explicit numeric clock times from the original transcription, resolves them as local date/time components with the injected IANA timezone, and persists the resulting UTC instant. The Ollama contract carries only explicit schedule components; it cannot supply an absolute UTC timestamp or timezone. Ambiguous, missing, or contradictory schedules are rejected into `Needs review`; an explicit date without a clock uses local midnight. The server's current default is UTC until device-timezone propagation is delivered by issue #187. `dueAt` is metadata only and never schedules notification delivery. This completes the production composition gap left after issues #57 and #58; it does not expand the approved action catalog, add hosted AI, or perform automatic Note-to-Task conversion.

### Operational verification

With local Whisper, Ollama, and the API running, first check the manager's selection and runtime state:

```sh
ai-runtime-manager status
ollama list
ollama ps
```

Then record four representative Captures in the iPhone client: a clear Task request, ordinary Note content, an ambiguous instruction, and an unsupported instruction. Poll the Member list and open each returned `detailUrl`:

```sh
curl --get http://127.0.0.1:3000/items --data-urlencode 'memberId=member-1'
curl http://127.0.0.1:3000/captures/capture-id-from-items/review
```

Confirm exactly one item per Capture: the clear request is one open Task, ordinary content is one accepted Note, and ambiguous or unsupported content is one `Needs review` Note with no Task. Each review must retain distinct Capture, source, transcription, Interpretation, and outcome identifiers. To verify recovery, stop Ollama for one additional Capture, confirm `state: "failed"`, `failure.stage: "interpretation"`, and `failure.retryable: true`, then restart Ollama and restart the API or repeat the same idempotent submission. It must resolve to one item without increasing the transcription attempt count or creating duplicate provenance records.

Startup creates the configured runtime directories and applies every unapplied migration in numeric version order. Applied versions are recorded in `schema_migrations`; a failed migration is rolled back and reported as a `MigrationError`. Migrations 5 and 6 add interpretation and automatic Task/Note outcome records; migration 9 adds durable interpretation-processing jobs.

## Selected libraries and boundaries

- Fastify 5 owns the local HTTP process and testable request lifecycle.
- Zod 4 validates environment configuration before startup.
- `better-sqlite3` 12 provides the SQLite connection and transaction primitive.
- Vitest 4 exercises the health, migration, blob-storage, capture, transcription, interpretation-provider, interpretation-runtime, and outcome seams.
- TypeScript 5.9 compiles in strict mode; `tsx` runs the local development entry point.
- Node filesystem APIs implement blob persistence behind the typed `BlobStorage` port.

The backend is a modular monolith. Feature modules own their use cases, rules, persistence mappings, and HTTP handlers. They may depend on typed ports and explicit contracts, but must not import SQLite, filesystem paths, another feature's tables, or provider-specific implementation details. Infrastructure adapters live under `apps/api/src/infrastructure`; shared ports live under `apps/api/src/shared`. Authentication and shared visibility remain outside the current implementation; the read-only review contract is implemented below.

## Capture contract

`POST /captures` accepts a JSON body with `memberId`, `idempotencyKey`, `audioBase64`, `contentType`, and ISO `capturedAt`. The audio content type must be an `audio/*` media type and the decoded payload must be non-empty. A successful response contains one stable `capture.id` and `capture.sourceId`, plus source metadata including byte length and SHA-256 digest. The original audio is stored below `API_BLOB_ROOT/captures/<capture-id>/original-audio`; `GET /captures/<capture-id>` returns metadata without audio bytes.

The `(memberId, idempotencyKey)` pair is unique. Retrying the same submission returns the original Capture and source; reusing the key with different audio is rejected with `409 Conflict`. Capture records and original audio are never updated by this contract.

Transcription is a separate durable feature record keyed one-to-one to a Capture. It moves through `pending`, `processing`, `succeeded`, and `failed` states, retains retry count and provider/model metadata, and stores transcription text without replacing source content. Failed work remains visible and may be retried. The transcription provider and Capture audio reader are typed ports; provider-specific behavior is not part of the feature module.

Interpretation is a separate durable record keyed one-to-one to a succeeded transcription. It preserves the source and transcription identifiers, catalog version, model, raw model output, and deterministic classification. Its separate processing job preserves attempt and recovery state without treating provider output as source content. The `direct-instructions.v1` catalog accepts only `create_task` and `complete_task` actions; `none` proposals are classified as `ordinary` or `ambiguous`. Malformed output, unsupported actions, and catalog-version mismatches are classified as `unsupported` with a rejection reason and never execute an action.

Automatic outcomes are separate durable records keyed one-to-one to an Interpretation. A clear `create_task` interpretation creates one open Task with its member and source lineage; ordinary, ambiguous, and unsupported interpretations create one Note containing the transcription text. Ambiguous and unsupported Notes are marked `Needs review`. Retrying materialization returns the existing outcome, and `complete_task` creates no new item. Task mutation uses an integer version for optimistic concurrency: edits require the current version, preserve all provenance identifiers, and may change only the title or non-notifying due information. An open Task may transition to `completed` once; repeating completion returns the completed Task unchanged, while stale edits and invalid transitions are rejected. No mutation invokes notification scheduling or delivery. Corrections and shared visibility remain outside this slice.

### Future Task mutation errors and retention

These rules define errors and retention for the future Task mutation contract. The current MVP requests without an `operationId` still do not implement operation replay, completed-Task edits, Reopen, or status-transition history.

Current route handlers commonly return `{ "error": "<message>" }`, with the HTTP status indicating the error class; the API does not define a central error handler or machine-readable error-code convention. Future Task mutation errors retain that body and add a stable `code`; a stale-version conflict also includes the current Task, as `{ "error": "Task version conflict", "code": "task_version_conflict", "task": <current task> }`. The Task contract uses these responses:

| Condition | HTTP status | `code` | Response details |
| --- | ---: | --- | --- |
| Invalid or incomplete mutation payload | `400` | `validation_error` | No mutation is applied. |
| Request has no authenticated Member identity | `401` | `unauthorized` | No mutation is applied. |
| Task is missing or not discoverable by this Member | `404` | `task_not_found` | Use the same response so private Task existence is not disclosed. |
| Current authenticated Member lacks permission for a discoverable Task | `403` | `forbidden` | No mutation is applied. |
| Operation ID was already used for a different operation or request | `409` | `idempotency_key_mismatch` | Do not apply or return the other operation's result. |
| `expectedVersion` is stale | `409` | `task_version_conflict` | Include the current Task for refresh; do not retry the mutation at the newer version. |

Check current authorization before looking up or returning a stored operation result. Errors never mutate the Task, operation result, or status history.

Retain each operation result and append-only status-transition record for as long as its Task data is retained. Do not expire or compact either record by age. Retention ends only when the associated Task data is explicitly deleted under the product's deletion policy; after that deletion, replay is no longer guaranteed. This preserves retries throughout the retained lifetime of the Task without changing the product's explicit-deletion rule.

### Operation-keyed personal Task mutations

Operation-keyed writes opt into the personal Task mutation contract:

- `PATCH /tasks/<task-id>` accepts `memberId`, `expectedVersion`, `operationId`, and at least one supported field (`title` or non-notifying `dueAt`). It can edit an open or completed Task, preserves status and provenance, and increments the version once.
- `POST /tasks/<task-id>/complete` and `POST /tasks/<task-id>/reopen` accept `memberId`, `expectedVersion`, and `operationId`. Actual status changes increment the version once and append a transition record. A current-version request to complete an already-completed Task or reopen an already-open Task succeeds without a version or history change.
- Replaying the same operation returns its saved Task result without another mutation. Reusing the same ID for a different request returns `409` with `idempotency_key_mismatch`. A stale version returns `409` with `task_version_conflict` and the current Task.
- Task changes, the operation result, and any transition record commit in one SQLite transaction. Operation results and transition history are retained with the Task data under the rule above.
- Requests without `operationId` retain the existing MVP route behavior, including rejecting edits to completed Tasks and offering no Reopen action. These requests do not acquire operation replay or history behavior.

This personal slice follows the current single-member API boundary: `memberId` remains a client-supplied owner selector and is recorded as the acting Member. The API does not authenticate that identity, so this check enforces stored ownership consistency but does not protect against a caller who can forge another `memberId`. Do not treat it as multi-member authorization. Shared Task membership and permissions remain outside this slice.

Notes use the same integer version for optimistic concurrency. `PATCH /notes/<note-id>` accepts `memberId`, `expectedVersion`, and editable `content`; it changes only the Note content and rejects empty content, wrong-member access, and stale versions without changing Capture, Source content, transcription, interpretation, or review state. A review may explicitly save a Note with `POST /captures/<capture-id>/review/note`; this requires a completed transcription and interpretation, creates at most one Note for that interpretation, marks the explicitly saved Note as accepted (`reviewState: "none"`), and returns the existing accepted Note on retry. Saving an existing `Needs review` Note requires matching member and provenance identifiers and resolves that Note to the accepted state. The response retains all provenance identifiers and returns `version: 0` for a new Note.

An explicit `POST /notes/<note-id>/convert-to-task` operation accepts `memberId` and `expectedVersion`. It atomically mutates the existing Note row into an open Task: the editable Note content becomes the Task title, the durable item ID and all provenance identifiers remain unchanged, `Needs review` is cleared, and no duplicate item is created. A successful conversion increments the version. Repeating the operation for the already-converted item returns the existing Task; a stale version or wrong Member is rejected. This operation has no Reminder or notification side effect.

## Review contract

`GET /captures/<capture-id>/review` returns a read-only review contract with `state`, `capture`, `source`, `transcription`, `correction`, `interpretation`, `interpretationProcessing`, `outcome`, and `failure` fields. The records remain separate and are connected by their stable identifiers; `correction` is `null` when no correction exists, and the runtime leaves its optional lookup seam unconfigured until correction persistence is implemented. The source includes a stable blob identifier without exposing filesystem paths. Missing records are returned as `null`. Failed transcription or interpretation work returns `state: "failed"` with a populated `failure`; interpretation failures use `stage: "interpretation"` and expose a client-safe `retryable` flag. `interpretationProcessing` exposes durable status and attempt count without exposing provider response bodies.

The lifecycle state is deterministic: an un-stored Capture or missing/in-progress downstream record is `pending`; a failed transcription or interpretation job is `failed`; an ambiguous or unsupported Note outcome is `needs_review`; and a chain with a durable outcome is `completed`. The source record contains an immutable audio-content descriptor only and never contains corrected or interpreted text.

## Member item list

`GET /items?memberId=<member>&limit=<1..100>&cursor=<opaque>` returns a stable, newest-first page of the Member's Stage 1 list. Each entry is one of:

- `kind: "task"`, with `state` `open` or `completed`;
- `kind: "note"`, with `state` `none` or `needs_review`; or
- `kind: "capture"`, with `state` `pending` or `failed` while transcription or interpretation has not produced a durable item.

Every entry includes a `detailUrl` for its provenance/review contract. The optional `nextCursor` is an opaque keyset cursor based on capture creation time and ID. It keeps pagination order stable when an entry changes processing state. The list is single-Member for the MVP; authentication and cross-Member filtering remain outside this contract.
