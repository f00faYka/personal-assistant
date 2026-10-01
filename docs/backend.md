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
| `OLLAMA_MODEL` | `qwen3.5:4b` | Local Qwen model used and recorded for interpretations |
| `OLLAMA_TIMEOUT_MS` | `120000` | Per-attempt local Ollama timeout, from 1 second to 10 minutes |
| `INTERPRETATION_MAX_ATTEMPTS` | `3` | Durable interpretation attempt cap, from 1 to 10 |

Copy `.env.example` to `.env` to override the defaults. `.env`, SQLite files, `local-data/`, generated output, and other runtime-data directories are excluded from version control.

## Local Whisper runtime

### Supervised local development

The development-only `npm run dev:all` command supervises the local stack. Configure the command through the repository `.env` described in [`.env.example`](../.env.example); do not put machine-specific model or binary paths in source code. The endpoint, binary path, and model path may point to another reviewed installation without a code change.

The routine first checks the configured Whisper and Ollama health endpoints. A healthy service is reused. Otherwise it starts the configured Ollama binary with `serve` or the configured `whisper-server` binary with the configured model path, waits until the health check succeeds, and verifies the configured Ollama model via its tags endpoint. Only after those checks does it start API and Expo. Ctrl+C cleans up children started by the routine and leaves reused services running. Missing assets, an unavailable Ollama model, duplicate startup, process failure, and timeout are actionable errors; no binary or model is downloaded.

When launched from Herdr (`HERDR_ENV=1`), the same command targets the `run` tab in the current workspace. It reuses labelled `personal-assistant API` and `personal-assistant Expo` panes, creates separate panes for missing services, and keeps the launcher alive so Ctrl+C sends a literal interrupt only to panes created by this invocation. The existing run-tab panes and already-ready Ollama/Whisper services are not stopped.

The current interpretation provider intentionally remains a direct HTTP adapter. The SDK evaluation found no concrete benefit for this boundary: the adapter already owns the small request/response contract, timeout, structured-output format, safe-error translation, and configured model provenance. Adding an SDK would add dependency and lifecycle coupling without changing those contracts, so no SDK is adopted in this prototype.

The production API expects the owner-operated [`whisper.cpp` HTTP server](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server) to be running before a voice Capture is submitted. Build `whisper-server`, download a compatible model, install `ffmpeg`, and start the server with conversion enabled so iPhone formats such as M4A are accepted. A default-compatible command from the `whisper.cpp` checkout is:

```sh
./build/bin/whisper-server -m models/ggml-small.bin --language auto --host 127.0.0.1 --port 8080 --convert
```

Use a multilingual Whisper model without the `.en` suffix; English-only models can force non-English speech into an English transcription path. `--language auto` enables language detection, and the server must not be started with `--translate`, because the product preserves the speaker's original language. Keep the server bound to localhost and do not run it with administrative privileges. Set `WHISPER_ENDPOINT` if its host, port, request prefix, or inference path differs. Set `WHISPER_MODEL` to the identifier operators should see in transcription provenance; the API records this configured value and does not load or replace the server's model.

API startup creates one serial transcription worker before accepting requests. It first discovers any stored Captures that predate this runtime wiring and creates their missing transcription records. After new immutable Capture audio is stored, both direct Capture submission and audio Offline-draft synchronization create or discover the Capture's one durable transcription record, then queue it without waiting for inference to finish. The worker sends the original bytes as multipart field `file`, requests `response_format=json`, and stores the returned text separately with `provider: whisper.cpp` and the configured model identifier.

Each queue delivery performs at most one provider attempt. Startup recovers durable `pending`, interrupted `processing`, and `failed` records whose attempt count remains below `TRANSCRIPTION_MAX_ATTEMPTS`; an idempotent repeat of the original Capture submission can also redeliver the same job. A provider failure leaves the Capture and original audio unchanged, records a safe `failed` transcription, and increments its attempt count. If the process was interrupted during the final permitted attempt, startup records that interruption as failed without making another provider call. Once the cap is reached, automatic startup/delivery recovery leaves the transcription failed for operator review instead of retrying forever. `GET /captures/<capture-id>/review` and `GET /items` expose the existing failed state; provider response bodies are not stored in the client-visible failure message.

The transcription layer remains provider-neutral and does not classify content or materialize an item. After it stores a successful transcription, it hands the durable record to the separate interpretation worker described below. This preserves the provider boundary completed in issue #98 without adding a hosted fallback or changing Capture/source immutability.

## Local Qwen/Ollama runtime

The production API expects a local [Ollama](https://docs.ollama.com/) process with the configured Qwen model available. Install Ollama, keep its API bound to localhost, and fetch the default model before starting the API:

```sh
ollama pull qwen3.5:4b
```

Set `OLLAMA_ENDPOINT` when the local `/api/chat` address differs and set `OLLAMA_MODEL` to another reviewed local model when needed. The adapter sends a non-streaming chat request with temperature zero and the approved Direct-instruction JSON schema in Ollama's [`format` field](https://docs.ollama.com/capabilities/structured-outputs). It records the configured model and the parsed raw structured output with the resulting Interpretation. HTTP failures, timeouts, invalid API responses, and invalid structured JSON are translated to safe errors without retaining provider response bodies.

The serial interpretation worker starts before transcription recovery. It discovers succeeded transcriptions that have no interpretation job, accepts newly succeeded transcriptions, and durably moves each job through `pending`, `processing`, `succeeded`, or `failed`. One provider attempt may create or rediscover one versioned Interpretation, then idempotently materialize its existing outcome contract: a clear `create_task` creates one Task, ordinary content creates one Note, and ambiguous or unsupported content creates one `Needs review` Note. Interpretation and outcome uniqueness prevent duplicate durable results across redelivery or restart.

Each queue delivery performs at most one interpretation attempt. Startup retries `pending`, interrupted `processing`, and retryable `failed` jobs below `INTERPRETATION_MAX_ATTEMPTS`; an idempotent repeat of the original Capture submission also redelivers its already-succeeded transcription without running Whisper again. When an interruption occurs after the Interpretation is durable, startup materializes or rediscovers its outcome and completes the job without another provider call, including after the final permitted provider attempt. A final interrupted attempt with no durable Interpretation becomes non-retryable instead. A provider failure preserves the Capture and succeeded transcription, stores only the safe failure message, and exposes the attempt count and retryable flag in detailed review. `GET /items` shows the Capture as failed until a later retry succeeds. Deterministic interpretation extracts supported English and Russian relative dates, spoken clock numbers, and explicit clock times from the original transcription, resolves them as local date/time components with the injected IANA timezone, and persists the resulting UTC instant. The Ollama contract carries only explicit schedule components; it cannot supply an absolute UTC timestamp or timezone. Ambiguous, missing, or contradictory schedules are rejected into `Needs review`; an explicit date without a clock uses local midnight. The server's current default is UTC until device-timezone propagation is delivered by issue #187. `dueAt` is metadata only and never schedules notification delivery. This completes the production composition gap left after issues #57 and #58; it does not expand the approved action catalog, add hosted AI, or perform automatic Note-to-Task conversion.

### Operational verification

With local Whisper, Ollama, and the API running, first confirm that Ollama has the configured model:

```sh
ollama list
curl http://127.0.0.1:11434/api/chat \
  -H 'content-type: application/json' \
  -d '{"model":"qwen3.5:4b","stream":false,"format":"json","messages":[{"role":"user","content":"Return JSON with an ok field set to true"}]}'
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
