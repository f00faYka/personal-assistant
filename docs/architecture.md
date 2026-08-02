# Architecture

## Status

Architecture discovery has not started. This document records only product-mandated boundaries and technical constraints already present in the source brief. It deliberately does not select a backend language, framework, database, job system, storage provider, deployment topology, authentication method, push provider, or concrete React Native setup.

No diagram here should be interpreted as an accepted deployment architecture until the owner reviews and records the relevant decision in `decisions.md`.

## Accepted boundaries and invariants

### Trust and data boundaries

- Two distinct user identities and private data boundaries are required.
- Private content must not become shared automatically.
- Authorization, ownership, isolation, destructive-action safeguards, reminder scheduling, consistency, and business invariants are deterministic application responsibilities.
- AI inference is untrusted input to deterministic validation and authorization.

### Content provenance

- Original audio, transcription, structured interpretation, confidence information, proposed/performed action, and confirmation history must remain distinguishable.
- AI output cannot silently replace original user content.
- The system needs enough metadata to audit important AI-assisted behavior.

### Client/backend boundary

- The mobile client records and uploads audio rather than being required to transcribe locally.
- The backend orchestrates transcription and other AI inference.
- Digest generation is scheduled on the backend; push delivery must work while the client is closed.
- The domain and backend should avoid unnecessary platform lock-in even if iOS is the first target.

### AI provider boundary

- Application use cases must not depend directly on Ollama, Whisper, Qwen, or one cloud model.
- Provider adapters must expose explicit request/response contracts with runtime validation.
- Deterministic processing should be used where it is sufficient.
- Local-first inference is a direction to evaluate, not permission to compromise correctness or user experience.

## Conceptual flow for discovery

The product requirements imply this logical flow, without specifying process boundaries or technologies:

`mobile capture → authenticated upload → durable audio record → transcription → confidence/ambiguity gate → user correction when needed → classification/structuring → schema validation → risk/authorization policy → automatic action or confirmation → auditable result`

This flow is a requirements map. Job boundaries, retries, idempotency, persistence transactions, and deployment placement require discovery.

## Required capability areas

Future architecture proposals must account for:

- mobile application and secure local state;
- authentication and authorization;
- domain/application services;
- database and migrations;
- binary audio storage;
- synchronous requests and asynchronous/background work;
- scheduling;
- local and optional cloud AI adapters;
- push delivery and deep-link routing;
- audit/observability data;
- secrets, backups, recovery, and updates.

## Quality attributes to evaluate

For a private two-user system, proposals should optimize for simplicity, maintainability, correctness, privacy, recoverability, and understandable operations. Discovery must make availability, latency, offline behavior, remote access, cost, energy use, and local-hardware constraints explicit rather than assuming public-SaaS scale.

## Unresolved architecture

All concrete selections and topology questions remain open and are tracked in `open-questions.md` and GitHub discovery issues. Accepted outcomes belong in `decisions.md`; this file should then be updated to describe the resulting architecture.
