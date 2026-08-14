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

Copy `.env.example` to `.env` to override the defaults. `.env`, SQLite files, `local-data/`, generated output, and other runtime-data directories are excluded from version control.

Startup creates the configured runtime directories and applies every unapplied migration in numeric version order. Applied versions are recorded in `schema_migrations`; a failed migration is rolled back and reported as a `MigrationError`. Migrations 5 and 6 add interpretation and automatic Task/Note outcome records.

## Selected libraries and boundaries

- Fastify 5 owns the local HTTP process and testable request lifecycle.
- Zod 4 validates environment configuration before startup.
- `better-sqlite3` 12 provides the SQLite connection and transaction primitive.
- Vitest 4 exercises the health, migration, blob-storage, capture, transcription, and interpretation seams.
- TypeScript 5.9 compiles in strict mode; `tsx` runs the local development entry point.
- Node filesystem APIs implement blob persistence behind the typed `BlobStorage` port.

The backend is a modular monolith. Feature modules own their use cases, rules, persistence mappings, and HTTP handlers. They may depend on typed ports and explicit contracts, but must not import SQLite, filesystem paths, another feature's tables, or provider-specific implementation details. Infrastructure adapters live under `apps/api/src/infrastructure`; shared ports live under `apps/api/src/shared`. Authentication and shared visibility remain outside the current implementation; the read-only review contract is implemented below.

## Capture contract

`POST /captures` accepts a JSON body with `memberId`, `idempotencyKey`, `audioBase64`, `contentType`, and ISO `capturedAt`. The audio content type must be an `audio/*` media type and the decoded payload must be non-empty. A successful response contains one stable `capture.id` and `capture.sourceId`, plus source metadata including byte length and SHA-256 digest. The original audio is stored below `API_BLOB_ROOT/captures/<capture-id>/original-audio`; `GET /captures/<capture-id>` returns metadata without audio bytes.

The `(memberId, idempotencyKey)` pair is unique. Retrying the same submission returns the original Capture and source; reusing the key with different audio is rejected with `409 Conflict`. Capture records and original audio are never updated by this contract.

Transcription is a separate durable feature record keyed one-to-one to a Capture. It moves through `pending`, `processing`, `succeeded`, and `failed` states, retains retry count and provider/model metadata, and stores transcription text without replacing source content. Failed work remains visible and may be retried. The transcription provider and Capture audio reader are typed ports; provider-specific behavior is not part of the feature module.

Interpretation is a separate durable record keyed one-to-one to a succeeded transcription. It preserves the source and transcription identifiers, catalog version, model, raw model output, and deterministic classification. The `direct-instructions.v1` catalog accepts only `create_task` and `complete_task` actions; `none` proposals are classified as `ordinary` or `ambiguous`. Malformed output, unsupported actions, and catalog-version mismatches are classified as `unsupported` with a rejection reason and never execute an action.

Automatic outcomes are separate durable records keyed one-to-one to an Interpretation. A clear `create_task` interpretation creates one open Task with its member and source lineage; ordinary, ambiguous, and unsupported interpretations create one Note containing the transcription text. Ambiguous and unsupported Notes are marked `Needs review`. Retrying materialization returns the existing outcome, and `complete_task` creates no new item; task completion is handled by the later task-management stage. Corrections and shared visibility remain outside this slice.

## Review contract

`GET /captures/<capture-id>/review` returns a read-only review contract with `state`, `capture`, `source`, `transcription`, `correction`, `interpretation`, `outcome`, and `failure` fields. The records remain separate and are connected by their stable identifiers; `correction` is `null` when no correction exists, and the runtime leaves its optional lookup seam unconfigured until correction persistence is implemented. The source includes a stable blob identifier without exposing filesystem paths. Missing records are returned as `null`, while a failed transcription is returned as a present record with `state: "failed"` and a populated `failure` object.

The lifecycle state is deterministic: an un-stored Capture or missing/in-progress downstream record is `pending`; a failed transcription is `failed`; an ambiguous or unsupported Note outcome is `needs_review`; and a chain with a durable outcome is `completed`. The source record contains an immutable audio-content descriptor only and never contains corrected or interpreted text.
