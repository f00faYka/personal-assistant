# Roadmap

## Planning rules

GitHub Issues are the operational backlog; this document records phases, gates, and intended delivery order. Candidate scope after Phase 1 is deliberately provisional. Do not fully decompose implementation until the owner has reviewed the discovery outcomes.

The proposed initial issue set is preserved in [github-backlog.md](github-backlog.md) until it is published.

## Phase 0 — Repository and AI development workspace

**Goal:** make the project understandable and governable across human and Codex sessions.

Deliverables:

- version control and private GitHub repository;
- agent instructions and durable product/architecture/decision context;
- issue, branch, commit, pull-request, and review conventions;
- labels, epics, and initial discovery backlog;
- explicit unresolved questions;
- no feature implementation.

**Gate:** the owner reviews the repository structure, documents, and backlog before discovery begins.

## Phase 1 — Product and architecture discovery

**Goal:** clarify product behavior, choose an initial architecture with rationale, and define a testable first vertical slice.

Proposed discovery order:

1. Review and refine product context.
2. Define the minimum useful first release.
3. Define private/shared ownership and identity scenarios.
4. Define automatic-action and confirmation policy.
5. Define initial domain concepts and relationships.
6. Define digest and hands-free behavior relevant to early boundaries.
7. Clarify target devices, accounts, offline behavior, notifications, and deep links.
8. Evaluate backend boundaries and technology options.
9. Evaluate job-processing and reliability requirements.
10. Evaluate database, audit, binary storage, retention, and isolation options.
11. Benchmark local LLM runtime/models and local transcription.
12. Define AI provider, schema, confidence, escalation, evaluation, and observability boundaries.
13. Evaluate home-Mac role, deployment, remote access, push, secrets, backups, and recovery.
14. Define the first vertical slice from accepted decisions.
15. Convert accepted decisions into implementation issues.

Each discovery issue requires active owner participation and explicit review before closure.

**Gate:** major ambiguities are resolved or explicitly deferred; architecture and rationale are documented; implementation epics are refined; the first vertical slice is owner-approved.

## Phase 2 — First vertical slice (candidate only)

Likely validation target:

- two separate users and authentication;
- deterministic private/shared boundaries;
- manual text-note creation;
- creation of a simple task from a note;
- task viewing and completion;
- authorization and isolation tests.

Exact scope must be confirmed in Phase 1. Do not treat this list as approved implementation work.

## Phase 3 — Voice capture and local AI (candidate only)

Potential scope includes mobile recording/upload, local transcription, confidence/correction handling, classification and extraction, risk-gated automatic actions, confirmation flows, and full provenance storage.

## Phase 4 — Reminders, digest, and notifications (candidate only)

Potential scope includes reminder scheduling, digest generation, push delivery while the app is closed, deep links, user-specific/shared digest rules, and calendar view.

## Phase 5 — Contextual intelligence (candidate only)

Potential scope includes linking notes to existing items, follow-up instructions, smarter planning, context summarization, local-to-cloud escalation, and usage-based AI evaluation improvements.
