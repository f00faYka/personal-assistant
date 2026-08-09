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
- Deterministic application code must enforce authorization, ownership, isolation, destructive-action safeguards, scheduling, consistency, and other important business rules.
- Mobile clients upload audio; the backend orchestrates transcription and other AI inference.
- Product and architecture ambiguities are resolved through focused discovery and owner review before implementation.

## Open questions that still matter

- What is the minimum useful first release?
- What exact rules define private vs shared ownership and visibility changes?
- Which actions may run automatically, and which always require confirmation?
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
- creating a simple task from a note;
- task viewing and completion;
- authorization and isolation tests.

This is still a candidate boundary, not an accepted implementation commitment.
