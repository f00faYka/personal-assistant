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

Startup creates the configured runtime directories and applies every unapplied migration in numeric version order. Applied versions are recorded in `schema_migrations`; a failed migration is rolled back and reported as a `MigrationError`.

## Selected libraries and boundaries

- Fastify 5 owns the local HTTP process and testable request lifecycle.
- Zod 4 validates environment configuration before startup.
- `better-sqlite3` 12 provides the SQLite connection and transaction primitive.
- Vitest 4 exercises the health, migration, and blob-storage seams.
- TypeScript 5.9 compiles in strict mode; `tsx` runs the local development entry point.
- Node filesystem APIs implement blob persistence behind the typed `BlobStorage` port.

The backend is a modular monolith. Feature modules own their use cases, rules, persistence mappings, and HTTP handlers. They may depend on typed ports and explicit contracts, but must not import SQLite, filesystem paths, another feature's tables, or provider-specific implementation details. Infrastructure adapters live under `apps/api/src/infrastructure`; shared ports live under `apps/api/src/shared`. This foundation intentionally contains no Capture, Transcription, Interpretation, Task, Note, Review, authentication, or provider behavior.

## Capture contract

`POST /captures` accepts a JSON body with `memberId`, `idempotencyKey`, `audioBase64`, `contentType`, and ISO `capturedAt`. The audio content type must be an `audio/*` media type and the decoded payload must be non-empty. A successful response contains one stable `capture.id` and `capture.sourceId`, plus source metadata including byte length and SHA-256 digest. The original audio is stored below `API_BLOB_ROOT/captures/<capture-id>/original-audio`; `GET /captures/<capture-id>` returns metadata without audio bytes.

The `(memberId, idempotencyKey)` pair is unique. Retrying the same submission returns the original Capture and source; reusing the key with different audio is rejected with `409 Conflict`. Capture records and original audio are never updated by this contract. Authentication, transcription, correction, interpretation, durable Task/Note outcomes, and shared visibility are owned by later tickets.
