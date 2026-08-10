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

## Open questions that still matter

- What is the minimum useful first release?
- Which additional Direct instructions, if any, should be added after the first release?
- What are the initial domain concepts, fields, and lifecycles?
- What should the morning digest include, when should it run, and how should it behave for shared items?
- What hands-free behavior is safe, especially while cycling?
- Which devices, accounts, and offline behaviors are in scope first?
- What backend, database, storage, job, push, deployment, and operational choices best fit the project?
- Which local AI runtime, transcription stack, and provider boundaries should be used?

## Intended first release boundary

The current intended first release boundary is a small, useful vertical slice focused on core capture and task handling, not voice automation or full AI orchestration.

The likely shape of that first slice is:

- separately authenticated members;
- deterministic private/shared boundaries;
- manual text-note creation;
- explicit Member creation of a simple task from a Note;
- task viewing and completion;
- authorization and isolation tests.

This is still a candidate boundary, not an accepted implementation commitment.
