# Implementation backlog

This file routes implementation agents through the approved first-release tickets. GitHub is authoritative for whether a ticket is open or closed; this table is authoritative for traversal order when more than one ticket is eligible.

The product boundary is in [`product-brief.md`](product-brief.md), the domain glossary is in [`CONTEXT.md`](CONTEXT.md), the initial architecture is resolved in [issue 50](https://github.com/f00faYka/personal-assistant/issues/50), and the staged backlog specification is resolved in [issue 52](https://github.com/f00faYka/personal-assistant/issues/52).

## Select the next ticket

When `$implement` is invoked without an explicit ticket:

1. Read this file, `product-brief.md`, and `CONTEXT.md`.
2. Fetch the live GitHub state of the tickets in table order.
3. A ticket is eligible when it is open and every ticket in its **Blocked by** cell is closed as completed.
4. Select the first eligible ticket in table order. If none is eligible, report the open blockers and stop.
5. Read the selected ticket body and its linked specification sources before changing files.

When `$implement` names a ticket, verify that it is open and eligible before starting it. A closed dependency means its reviewed work has landed; an open dependency still blocks implementation even if code exists on an unmerged branch.

## Implementation workflow

`main` is the development and integration branch. Every implementation ticket uses one branch and one pull request:

1. Start from a clean checkout of the latest `main`.
2. Claim the selected GitHub issue by assigning it to the authenticated implementer.
3. Create a branch named `pass-<zero-padded-ticket-number>-<short-slug>`, for example `pass-0078-bootstrap-backend`.
4. Implement only that ticket. Use TDD at its declared seams, run focused checks during development, and run the ticket's full relevant checks before review.
5. Run `$code-review` against `main...HEAD` and resolve all blocking findings.
6. Commit with `PASS-<zero-padded-ticket-number>: <summary>`.
7. Push the ticket branch and open a pull request targeting `main`. Include `Closes #<ticket-number>` in the pull-request body and include the executed validation evidence.
8. Leave merging to the human owner unless the owner explicitly requests an agent merge. The next dependent ticket becomes eligible only after the pull request is merged and its issue is closed as completed.

Keep unrelated work out of the branch. If implementation exposes an unresolved product or architecture decision, record the blocker on the issue and pause that ticket rather than choosing a new policy in code.

## Ticket index

| Order | Stage | Ticket | Kind | Blocked by |
| ---: | --- | --- | --- | --- |
| 1 | Foundation | [#78 — Bootstrap the runnable backend foundation](https://github.com/f00faYka/personal-assistant/issues/78) | BE | None |
| 2 | Stage 1 | [#55 — Persist immutable Captures and source content](https://github.com/f00faYka/personal-assistant/issues/55) | BE | #78 |
| 3 | Stage 1 | [#56 — Transcribe Captures with durable processing state](https://github.com/f00faYka/personal-assistant/issues/56) | BE | #55 |
| 4 | Stage 1 | [#57 — Validate supported interpretation actions](https://github.com/f00faYka/personal-assistant/issues/57) | BE | #56 |
| 5 | Stage 1 | [#58 — Persist automatic Task and Note outcomes](https://github.com/f00faYka/personal-assistant/issues/58) | BE | #57 |
| 6 | Stage 1 | [#59 — Expose provenance and review state](https://github.com/f00faYka/personal-assistant/issues/59) | BE | #58 |
| 7 | Stage 1 | [#60 — Edit and complete Tasks](https://github.com/f00faYka/personal-assistant/issues/60) | BE | #58 |
| 8 | Stage 1 | [#61 — Edit Notes from review](https://github.com/f00faYka/personal-assistant/issues/61) | BE | #58, #59 |
| 9 | Stage 1 | [#62 — List Member items and result states](https://github.com/f00faYka/personal-assistant/issues/62) | BE | #58 |
| 10 | Stage 1 | [#63 — Display the Stage 1 list surface](https://github.com/f00faYka/personal-assistant/issues/63) | FE | #62 |
| 11 | Stage 1 | [#64 — Record and submit voice Captures](https://github.com/f00faYka/personal-assistant/issues/64) | FE | #55, #63 |
| 12 | Stage 1 | [#65 — Show processing status and the result-first preview](https://github.com/f00faYka/personal-assistant/issues/65) | FE | #56, #58, #62, #64 |
| 13 | Stage 1 | [#66 — Open and edit the detailed review](https://github.com/f00faYka/personal-assistant/issues/66) | FE | #59, #60, #61, #65 |
| 14 | Stage 1 | [#67 — Show Needs review and failure states](https://github.com/f00faYka/personal-assistant/issues/67) | FE | #59, #65 |
| 15 | Stage 1 | [#68 — Edit and complete Tasks](https://github.com/f00faYka/personal-assistant/issues/68) | FE | #60, #66 |
| 16 | Stage 1 | [#69 — Review and save Notes](https://github.com/f00faYka/personal-assistant/issues/69) | FE | #61, #66 |
| 17 | Stage 1 | [#70 — Show due information without notification semantics](https://github.com/f00faYka/personal-assistant/issues/70) | FE | #60, #68 |
| 18 | Stage 2 | [#71 — Accept and reconcile Offline drafts](https://github.com/f00faYka/personal-assistant/issues/71) | BE | #55, #56, #57, #58 |
| 19 | Stage 2 | [#72 — Mutate a Note into a Task](https://github.com/f00faYka/personal-assistant/issues/72) | BE | #58, #60, #61 |
| 20 | Stage 2 | [#73 — Expose synchronization state](https://github.com/f00faYka/personal-assistant/issues/73) | BE | #71 |
| 21 | Stage 2 | [#74 — Persist and display Offline drafts](https://github.com/f00faYka/personal-assistant/issues/74) | FE | #63, #64 |
| 22 | Stage 2 | [#75 — Synchronize drafts and display server results](https://github.com/f00faYka/personal-assistant/issues/75) | FE | #65, #71, #73, #74 |
| 23 | Stage 2 | [#76 — Convert a saved Note into a Task](https://github.com/f00faYka/personal-assistant/issues/76) | FE | #68, #69, #72 |
| 24 | Stage 1 runtime gap | [#98 — Run persisted Captures through local Whisper](https://github.com/f00faYka/personal-assistant/issues/98) | BE | #55, #56 |
| 25 | Stage 1 runtime gap | [#99 — Interpret transcriptions and materialize runtime outcomes](https://github.com/f00faYka/personal-assistant/issues/99) | BE | #57, #58, #98 |
| 26 | Stage 2 | [#77 — Display synchronization and conversion outcomes](https://github.com/f00faYka/personal-assistant/issues/77) | FE | #73, #75, #76, #98, #99 |
