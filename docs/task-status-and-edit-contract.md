# Task status and edit contract

**Product decision:** Resolved by the owner in [#180](https://github.com/f00faYka/personal-assistant/issues/180). This document records the agreed Task behavior; it does not claim that every capability is implemented.

**Implementation state:** [#208](https://github.com/f00faYka/personal-assistant/issues/208) settled operation errors and retention. [#209](https://github.com/f00faYka/personal-assistant/issues/209) implements operation-keyed mutations for personal Tasks in the current single-member API. [#210](https://github.com/f00faYka/personal-assistant/issues/210) remains open for Shared Tasks and depends on authenticated identity, membership, and authorization foundations. Current routes and persistence details are in [`backend.md`](backend.md).

## Agreed Task behavior

- A Task has `open` or `completed` status. Only an explicit status action changes it. Editing the title or non-notifying due information never changes status.
- Open and completed Tasks may be edited. An edit preserves status and immutable creator, Capture, source, and interpretation provenance, and advances the version once.
- Completion explicitly changes `open` to `completed`; Reopen explicitly changes `completed` to `open`. A later ordinary edit to a completed Task does not resume it. Any follow-up work that is not an explicit Reopen is a new Task.
- Reopening a personal Task requires current ownership. For a Shared Task, the product decision grants Reopen to an Active Member who currently has permission to complete that Task. Creator or completion history grants no additional authority.
- Each actual status transition appends an audit record with the actor, server time, previous and resulting status, operation ID, and resulting version. Status changes do not rewrite creator or source provenance.
- Each mutation uses an expected Task version and stable operation ID. Replaying the same operation returns its original result without another mutation or history record. Reusing an ID for a different request is rejected. A stale version conflicts and returns current state for refresh; the server does not silently retry at a newer version.
- A new Reopen request against an already-open Task at its current version succeeds without changing the Task, version, or history. Due information remains non-notifying metadata; these mutations do not schedule or deliver Reminders.

## Identity and authorization boundary

The intended multi-member authorization rule is based on the current authenticated Member, membership, ownership, and sharing permission. Authorization must be checked before returning a saved operation result, so replay cannot expose a Task after access has been revoked.

The current personal mutation implementation intentionally follows the owner's single-member direction: `memberId` is supplied by the client and checked against stored Task ownership. It is not authenticated identity and is forgeable, so it does not provide a multi-member security boundary. Shared Task mutation remains unimplemented until the accepted authentication, membership, and authorization foundations exist.

## Persistence, errors, and retention

The Task change, operation result, and any transition record are committed atomically. A failed transaction leaves them unchanged. Operation results and append-only transition history are retained for as long as the associated Task data; they are not expired or compacted by age. Explicit deletion of the Task data also ends the replay guarantee for that Task.

The settled response codes and envelopes are specified in [`backend.md`](backend.md): validation errors use `400`; a missing authenticated identity uses `401`; missing or inaccessible Tasks use `404`; a discoverable Task without permission uses `403`; idempotency-key mismatch uses `409`; and stale versions use `409` with the current Task. The current personal API has no authenticated identity, so its owner mismatch follows the `404` path.

## State examples

| Starting state | Action | Result |
| --- | --- | --- |
| Open vN | Complete with expected vN | Completed vN+1; append `open → completed` |
| Completed vN+1 | Reopen with expected vN+1 | Open vN+2; append `completed → open` |
| Open vN+2 | Replay the same Reopen operation | Return its saved result; no new transition or version |
| Open vN+2 | New Reopen with expected vN+2 | Success unchanged; no transition |
| Completed vN | Edit title or due information with expected vN | Updated fields, still completed, version vN+1 |
| Any Task | Mutation with a stale version | Conflict with current Task; no mutation |

## Scope references

- [#180](https://github.com/f00faYka/personal-assistant/issues/180) owns the product decision and explicit Reopen policy.
- [#208](https://github.com/f00faYka/personal-assistant/issues/208) owns the error response and retention decisions.
- [#209](https://github.com/f00faYka/personal-assistant/issues/209) implements the personal Task mutation slice under the current single-member API boundary.
- [#210](https://github.com/f00faYka/personal-assistant/issues/210) owns applying the contract to Shared Tasks after its authorization foundations exist.
