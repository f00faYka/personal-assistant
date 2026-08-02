# Proposed GitHub backlog

## Status and publishing contract

This reviewable Phase 0 plan preserves the backlog until the private GitHub repository and issues can be created. GitHub will remain the operational backlog; issue numbers and links will be added here after publication. Nothing in a discovery issue is accepted until the human owner reviews it.

`PASS` is the project key. Every epic and issue below has a permanent `PASS-####` identifier. Published issue titles must start with that identifier followed by a colon, for example `PASS-0014: Review and refine the product context with the human owner`. Future identifiers are allocated sequentially from `PASS-0036`; identifiers are never reused or renumbered.

Every published issue will include context, goal, scope, non-goals where useful, open questions, expected output, acceptance criteria, dependencies, relevant documents, and whether human input is required. Every discovery issue must also:

- explain alternatives and trade-offs before asking for a choice;
- use concrete scenarios, benchmarks, or experiments where appropriate;
- produce an owner-reviewed conclusion or explicit deferral;
- update decisions, open questions, and affected documentation;
- create follow-up issues where needed;
- remain open until human review is complete.

## Labels

epic, discovery, architecture, product, backend, mobile, ai, infrastructure, security, testing, documentation, blocked, needs-human-input, ready, in-progress

## Epics

| ID | Proposed title | Labels | Intended outcome |
| --- | --- | --- | --- |
| PASS-0004 | Project foundation and AI development workflow | epic, documentation | Private repository, durable context, conventions, and backlog; no features |
| PASS-0005 | Product discovery and domain definition | epic, product, discovery | Owner-reviewed behavior, release boundary, and domain |
| PASS-0006 | Architecture and technology evaluation | epic, architecture, discovery | Owner-reviewed architecture with rationale and deferrals |
| PASS-0007 | Identity, privacy, and shared-data boundaries | epic, product, security | Deterministic, testable identity, ownership, sharing, and isolation |
| PASS-0008 | Core notes and task management | epic, product, backend, mobile | Refined implementation work after discovery |
| PASS-0009 | Voice capture and transcription | epic, mobile, backend, ai | Approved recording, upload, storage, transcription, confidence, and correction work |
| PASS-0010 | AI classification and automated actions | epic, ai, backend, security | Safe, validated, measurable interpretation and automation |
| PASS-0011 | Reminders, digest, and push notifications | epic, product, backend, mobile, infrastructure | Approved scheduling, digest, delivery, and deep-link work |
| PASS-0012 | Deployment, operations, and backups | epic, infrastructure, security | Operable, secure, recoverable private deployment |
| PASS-0013 | Quality, security, and observability | epic, testing, security | Cross-cutting authorization, reliability, evaluation, audit, and privacy verification |

PASS-0004 has no dependency. PASS-0005 and PASS-0006 follow PASS-0004. PASS-0007 depends on relevant PASS-0005/PASS-0006 decisions. Feature epics PASS-0008–PASS-0011 remain deliberately unrefined until Phase 1. PASS-0012 and PASS-0013 are cross-cutting and are refined from architecture and product risk decisions.

## Foundation issues

| ID | Proposed title | Labels | Output and dependency |
| --- | --- | --- | --- |
| PASS-0001 | Initialize Git repository and connect GitHub | documentation, infrastructure | Local `main` synchronized with private `f00faYka/personal-assistant`; owner review required |
| PASS-0002 | Create the AI-agent documentation workspace | documentation | Required durable context, neutral ignore rules, and navigation; owner review required |
| PASS-0003 | Define the GitHub issue and development workflow | documentation | Labels, issue model, branch/commit/PR/review conventions, work-selection rules, and templates; owner review required |

## Discovery issues

All issues below receive discovery, needs-human-input, and the listed domain labels. They cannot close until the owner reviews their output.

| ID | Proposed title | Domain labels | Question and expected output | Dependencies |
| --- | --- | --- | --- | --- |
| PASS-0014 | Review and refine the product context with the human owner | product | Validate users, scenarios, terminology, priorities, non-goals, and unacceptable privacy/safety failures | PASS-0002 |
| PASS-0015 | Define the minimum useful first release | product | Choose the smallest useful day-in-the-life scope, success signals, manual fallbacks, and explicit deferrals | PASS-0014 |
| PASS-0016 | Define private/shared ownership and sharing behavior | product, security | Decide private defaults, owners/participants, permissions, visibility changes, confirmations, unsharing, and deletion; produce testable policy | PASS-0014 |
| PASS-0017 | Define automatic-action and confirmation rules | product, ai, security | Produce an action/risk matrix for ambiguity, missing data, confidence, edits/deletes, shared data, and external effects | PASS-0014, PASS-0016 |
| PASS-0018 | Define initial domain concepts and relationships | product, architecture, backend | Clarify notes, tasks, reminders, shopping, event candidates, provenance, linking, fields, statuses, and lifecycles without choosing a schema | PASS-0014–PASS-0017 |
| PASS-0019 | Define morning-digest behavior | product, backend, mobile | Define per-user contents, ranking, time zone/schedule, quiet hours, shared items, deep link, refresh, and failures | PASS-0016, PASS-0018 |
| PASS-0020 | Define hands-free interaction and safety boundaries | product, mobile, ai, security | Define eyes-busy scenarios, safe commands, audio dialogue, authentication, interruption, confirmation, refusal, and release phase | PASS-0015, PASS-0017 |
| PASS-0021 | Clarify target devices, accounts, and usage contexts | product, mobile, security | Confirm devices/OS versions, personal/shared devices, account assumptions, accessibility, and exclusions | PASS-0014, PASS-0015 |
| PASS-0022 | Evaluate authentication options for a private two-user system | architecture, security, backend, mobile | Compare proportionate login, session, invitation, revocation, device-loss, and recovery approaches | PASS-0016, PASS-0021; deployment constraints as needed |
| PASS-0023 | Evaluate mobile-client architecture, offline behavior, notifications, and deep links | architecture, mobile | Evaluate React Native setup, navigation, server/secure local state, recording/upload, offline queue/conflicts, notifications, and deep links | PASS-0015, PASS-0019–PASS-0022; backend constraints |
| PASS-0024 | Evaluate backend architecture and technology options | architecture, backend | Define boundaries and compare language/framework choices for correctness, maintenance, AI integration, jobs, and deployment | PASS-0014–PASS-0018; coordinate with PASS-0025–PASS-0031 |
| PASS-0025 | Evaluate synchronous/asynchronous jobs and reliability requirements | architecture, backend, infrastructure | Map background work and define durability, retries, idempotency, timeouts, cancellation, recovery, and the simplest adequate job model | PASS-0019, PASS-0024, PASS-0029–PASS-0032 |
| PASS-0026 | Evaluate database, user isolation, and audit-storage options | architecture, backend, security | Compare databases for domain fit, transactions, migrations, isolation enforcement, auditability, deployment, and recovery | PASS-0016, PASS-0018, PASS-0024, PASS-0031, PASS-0033 |
| PASS-0027 | Define audio-file storage, retention, and deletion behavior | architecture, backend, security, infrastructure | Decide durable location, access/encryption, metadata linkage, backup, retention, deletion, and orphan cleanup | PASS-0016, PASS-0018, PASS-0031, PASS-0033 |
| PASS-0028 | Evaluate local LLM runtime and Qwen models on M1 Pro | architecture, ai, infrastructure, testing | Reproducibly benchmark task quality, structured-output reliability, latency, and memory for Ollama/justified alternatives and Qwen candidates | PASS-0017, PASS-0018; owner-approved evaluation inputs |
| PASS-0029 | Evaluate local Whisper implementation and transcription confidence | architecture, ai, backend, testing | Benchmark relevant languages/noise for accuracy, latency, packaging, confidence signals, and correction-gate calibration | PASS-0015, PASS-0020, PASS-0027; owner-approved audio scenarios |
| PASS-0030 | Define AI provider boundaries, schemas, routing, evaluation, and observability | architecture, ai, backend, testing, security | Define provider-neutral contracts, versioned schemas, validation/errors, routing/escalation/privacy gates, metrics, traces, and reproducibility | PASS-0017, PASS-0018, PASS-0024, PASS-0028, PASS-0029 |
| PASS-0031 | Evaluate deployment and home-Mac availability options | architecture, infrastructure, security | Compare complete-server, AI-worker, and development-only roles including secure access, sleep/offline behavior, privacy, cost, energy, and maintenance | PASS-0015, PASS-0024, PASS-0025, PASS-0028, PASS-0029 |
| PASS-0032 | Evaluate push-notification infrastructure | architecture, mobile, backend, infrastructure | Compare direct/managed delivery, token lifecycle, deep links, credentials, failure visibility, and realistic guarantees | PASS-0019, PASS-0021, PASS-0023, PASS-0031 |
| PASS-0033 | Define secrets, backups, updates, and recovery procedures | architecture, infrastructure, security, testing | Define secret rotation, data/audio backups, restore tests, retention, updates, rollback, monitoring, RPO/RTO, and recovery ownership | PASS-0026, PASS-0027, PASS-0031, PASS-0032 |
| PASS-0034 | Define the first vertical slice | product, architecture, backend, mobile, security, testing | Convert accepted decisions into one useful end-to-end scope with non-goals, demo, risk-reduction purpose, dependencies, and mandatory isolation tests | PASS-0014–PASS-0018, PASS-0021–PASS-0026, PASS-0031; others only if needed |

## Post-discovery planning issue

PASS-0035 — Convert accepted decisions into implementation issues

- Labels: documentation, product, architecture.
- Goal: after PASS-0034 approval, create meaningful first-slice implementation issues under the relevant epics.
- Scope: link every issue to accepted requirements and decisions; include dependencies, non-goals, acceptance criteria, test approach, and documentation impact.
- Non-goals: implementation, silently reopening decisions, or fully planning Phases 3–5.
- Acceptance: the owner reviews the backlog before any issue receives ready.
- Dependencies: PASS-0034 and every decision it names.
- Human input: required.

## Proposed initial order

1. PASS-0001–PASS-0003 — finish and review Phase 0.
2. PASS-0014 — product-context review.
3. PASS-0015 — minimum useful release.
4. PASS-0016 — private/shared ownership behavior.
5. PASS-0017 — automatic-action and confirmation policy.
6. PASS-0018 — domain concepts and relationships.
7. PASS-0019 and PASS-0020 — separate digest and hands-free discussions.
8. PASS-0021 and PASS-0022 — device/account scenarios, then authentication.
9. PASS-0023–PASS-0027 — client, backend/jobs, database/audit, and audio boundaries.
10. PASS-0028 and PASS-0029 — separate reproducible LLM and transcription evaluations.
11. PASS-0030 — provider/routing/schema/evaluation design using benchmark evidence.
12. PASS-0031–PASS-0033 — deployment, push, and operational recovery.
13. PASS-0034 — owner-approved first vertical slice.
14. PASS-0035 — convert accepted decisions into implementation issues.

Independent evaluations may overlap only after their scenarios and inputs are owner-approved. Conclusions still require separate human review.
