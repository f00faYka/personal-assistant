# Product context

## Status and source of truth

This document translates the owner-provided initialization brief into durable product context. It describes known requirements and current directions, not unreviewed implementation choices. Product changes require owner review and must be reflected here and, where significant, in `decisions.md`.

## Vision

Build a private life-assistant application for the owner and his wife. It should make it fast to capture thoughts, reminders, plans, and tasks—primarily with voice—while preserving privacy, user control, and an auditable history of AI involvement.

This is a private two-user product, not a public SaaS offering.

## Users and privacy

There are two users: the owner and his wife.

- Each person has a separate identity and private personal data.
- Private is the safe default; private notes must never become shared automatically.
- Selected household information may later be shared, including shopping, family plans, appointments, household tasks, and reminders involving children.
- Exact ownership, participation, visibility-change, and sharing rules remain unresolved.

## Primary use cases

1. Capture a voice note quickly and retain the original audio.
2. Turn clear, low-risk input into a note, task, reminder, shopping item, idea, backlog item, event candidate, or additional context for an existing item.
3. Review or correct uncertain transcription and ambiguous AI interpretations.
4. View and manage private and intentionally shared notes and tasks.
5. Receive a user-specific morning digest by push notification and open it at the relevant screen.
6. Use a hands-free spoken mode in situations such as cycling to capture notes, query tasks, and perform low-risk actions with audio responses.

Hands-free behavior, safety limits, interruption handling, and its release phase still require discovery.

## Voice-note workflow

The intended product behavior is:

1. Save the original audio file.
2. Send audio to the backend for speech transcription.
3. Evaluate transcription confidence and ambiguity.
4. When unclear, show the transcription for confirmation or editing.
5. When sufficiently clear, continue without interruption.
6. Classify and structure the resulting text with AI when AI is useful.
7. Determine the intended action and assess confidence and risk.
8. Execute only low-risk, sufficiently confident actions automatically.
9. Ask for confirmation when the intent is ambiguous, confidence is insufficient, required information is missing, existing data would change or be deleted, shared data is affected, or an external/consequential effect is possible.
10. Store the original audio, transcription, structured interpretation, confidence information, confirmation history, and resulting action for later review.

Thresholds, confidence signals, risk levels, and the exact action matrix are unresolved and require owner review.

## Information integrity and auditability

- Original transcription and structured AI interpretation are separate records.
- AI output never silently overwrites original user content.
- Automated actions, suggestions, corrections, confirmations, and relevant model/provider metadata must be reviewable.
- Deterministic application code—not AI alone—enforces authorization, user isolation, ownership, destructive-action safeguards, reminder scheduling, database consistency, and important business invariants.

## Task capability

A task may eventually contain:

- title;
- original note;
- description;
- owner;
- private or shared visibility;
- status;
- priority;
- due date;
- reminder date;
- project or area;
- tags;
- blocking reason;
- creation source;
- AI confidence.

Candidate initial statuses are `inbox`, `planned`, `in progress`, `blocked`, `waiting`, `review`, `completed`, and `cancelled`. Their exact semantics and whether every field belongs in the first release remain subject to domain discovery.

## Morning digest

A backend scheduler should generate a user-specific morning digest and arrange a push notification that can arrive when the mobile app is closed. Opening it should deep-link to a digest screen.

Candidate contents include unfinished, overdue, blocked, waiting, review, confirmation-required, and important-for-today tasks. Shared household tasks may appear for both users when appropriate. Timing, ranking, quiet hours, failure behavior, and shared-item rules are unresolved.

## AI responsibilities and limits

AI may support transcription, note classification, task-field extraction, natural-language date detection, potential-sharing suggestions, linking to existing items, digest generation, and context summarization.

Principles:

- Do not assume every request requires an LLM.
- Prefer deterministic parsing, validation, and business rules when sufficient.
- Use the smallest capable model and consider escalation only when justified.
- Use explicit, runtime-validated structured outputs.
- Make inference observable and reproducible where practical.
- Keep prompts and output schemas versioned.

## Current technical directions—not accepted selections

These guide discovery but do not close the associated decisions:

- React Native is the intended mobile direction; the first release may target iOS.
- Mobile clients upload audio; backend-side transcription is preferred.
- Local inference is preferred during development and initial personal use when quality and performance are adequate.
- Ollama, Qwen models, and local Whisper on an Apple Silicon M1 Pro are candidates that require evaluation.
- Cloud fallback may later handle requests that local models cannot process reliably.
- AI providers should be replaceable behind explicit boundaries.

No backend language/framework, database, storage service, deployment topology, job system, authentication method, push provider, or concrete mobile setup has been accepted.

## Candidate mobile capabilities

- authentication;
- private/shared views;
- voice recording and audio upload;
- transcription correction;
- interpretation review and confirmation;
- note/task viewing and management;
- push notifications and deep links;
- digest screen;
- task calendar view;
- hands-free spoken interaction.

## Required backend responsibilities

The implementation must provide boundaries for:

- authentication and user isolation;
- note/task persistence;
- audio metadata and storage;
- transcription jobs;
- AI classification and structuring;
- scheduled digest generation;
- push-notification orchestration;
- audit history for AI suggestions, automated actions, and confirmations.

How those responsibilities are packaged and deployed is unresolved.

## Non-goals for the first version

- public multi-tenant SaaS;
- team or organization administration;
- autonomous consequential actions;
- complex agent swarms;
- a general-purpose chatbot;
- automatic sharing of private notes;
- sophisticated semantic memory before basic workflows are reliable;
- infrastructure justified only by hypothetical future scale;
- premature product complexity unsupported by actual use.
