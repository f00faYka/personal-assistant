# Product brief

This is the condensed snapshot of the project after the initial reset.
It is the only durable product artifact in the repository.

## Product vision

Build a private life-assistant for the members of one small private group.

The product should help members quickly capture thoughts, reminders, plans, and tasks, primarily through voice notes, while preserving privacy, member control, and an auditable history of AI involvement.

The product is private-first and is not intended to be a public SaaS.

## Current accepted decisions

- The product serves one private group, typically containing two to six members; it must not encode a two-user limit.
- The owner and his wife are the initial members, but that launch context is not a domain constraint.
- Each member has a separate identity, equal product capabilities, and private personal data.
- Private content must not become shared automatically.
- Original content created by a member, transcription corrections, and structured AI interpretations must remain separate.
- AI output must never silently overwrite original content.
- Direct instructions are the main action path: a clear instruction may create a scheduled Task and Reminder or complete a named Task. Ordinary notes do not cause AI to infer Tasks or reminders.
- AI responsibility is limited to transcription, understanding supported Direct instructions, and adding editable tags or captions. Unclear instructions cause no action and remain available for Member review.
- The relevant Member may view the history of the source, transcription, Direct instruction, parsed result, and resulting action. Shared visibility rules still protect private source content and provenance.
- Membership is invite-only: an Invitation is single-use and expiring, all Active Members can see and revoke pending Invitations, and any Active Member can create one.
- Members have equal product capabilities and there is no permanent administrator. Removing a Member requires unanimous confirmation from every unaffected Active Member; self-removal is always available.
- A Member identity remains stable across devices and recovery. Recovery cannot expose private content, silently transfer identity, or automatically merge identities.
- When a Member leaves, private content remains theirs and inaccessible to the group, while explicitly shared content remains shared. Shared Tasks preserve their original owner attribution and remain completable by remaining Members.
- When the last Member leaves, the Private Group is archived, rejects new Invitations, and retains data until explicit deletion.
- Tasks are the first shareable durable item type. A newly created Task is owned by its creator by default, while creator provenance remains immutable and ownership can be explicitly reassigned. The current owner controls sharing and can withdraw it. Other Active Members can view and edit practical details, progress, status, and due information, add progress, acknowledge, and complete a Shared Task, without gaining access to private source or provenance data. Shared due dates and task-level Reminders are group-visible; notification preferences and acknowledgment state remain private.
- Deterministic application code must enforce authorization, ownership, isolation, destructive-action safeguards, scheduling, consistency, and other important business rules.
- Mobile clients upload audio; the backend orchestrates transcription, Direct-instruction parsing, and limited Note metadata such as tags and captions.
- Product and architecture ambiguities are resolved through focused discovery and owner review before implementation.

## Post-MVP questions and evidence gates

- Which additional Direct instructions, if any, should be added after the first release?
- What evidence should authorize Personal reliability capabilities such as notification Reminders and Digests?
- What evidence should authorize Private Group collaboration and its identity, invitation, sharing, and Shared Task behavior?
- What hands-free activation, interruption, failure recovery, read-aloud, and cycling-safety behavior is acceptable?
- Which later feature-extension seams and migrations are needed after later capabilities are prioritized?
- Which model and transcription evaluations and quality thresholds are justified by observed tasks, latency needs, and privacy constraints?
- Which hosted infrastructure or third-party integrations, if any, are justified by real member workflows?

## Accepted first release (MVP) boundary

The first release is the smallest genuinely useful product release and tests the core audio-to-Task assumption. It is an MVP boundary, not the end of the product roadmap.

The first release is a staged, single-Member, iOS-focused React Native slice.

### Stage 1: online audio-to-result

- start an explicit in-app voice Capture from the existing list;
- preserve the original audio, transcription, correction, interpretation, classification, and resulting durable item as separate traceable records;
- transcribe and interpret automatically using the supported versioned Direct-instruction catalog;
- create exactly one Task for a clear supported Direct instruction, without a second confirmation;
- create exactly one Note for ordinary, non-Task, ambiguous, or unsupported content; ambiguous and unsupported results are marked `Needs review` and create no Task;
- show the accepted result-first preview, with a default 15-second unattended save window; opening detailed review stops the timer and `Save` commits immediately;
- allow the Member to edit the resulting Task or Note and complete a Task without overwriting source content;
- preserve the Capture and expose a durable failure or review state when processing fails;
- allow non-notifying due information on Tasks, but do not deliver scheduled notification Reminders.

Manual Note creation is an explicit action from the review view, not a separate standalone typed-capture entry point in Stage 1.

### Stage 2: offline continuity and explicit conversion

- preserve audio or text as a durable `Offline draft` when the backend cannot confirm synchronization;
- show the draft as visibly pending, disabled, or unconfirmed until server confirmation;
- synchronize drafts idempotently when connectivity returns, preserving originals across retry or failure;
- keep offline Task editing, offline completion, and conflict resolution out of this stage;
- let a Member explicitly convert a saved Note into a Task by mutating the existing item in place, retaining its identity and provenance and creating no duplicate.

Authentication, multi-Member support, sharing, notification Reminders, Plans, Digests, hands-free activation, and broader AI automation remain deferred to later roadmap phases. The first release does not establish the final authorization or sharing implementation, but later work must preserve those domain boundaries.
