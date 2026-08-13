# Repository instructions for AI agents

Before starting work:

1. Read [`product-brief.md`](product-brief.md).
2. Review the relevant GitHub issue, if one exists.

## Working rules

- Treat `product-brief.md` as the source of truth for the current project snapshot.
- Prefer the smallest change that solves the task.
- Do not silently expand scope beyond the brief.
- Preserve the current product direction unless the human owner changes it.
- Keep original content separate from AI interpretation.
- Use deterministic code for authorization, ownership, destructive-action safeguards, scheduling, consistency, and other business invariants.
- Prefer working from an approved GitHub issue when one exists.
- Update the brief if implementation changes the agreed product direction.
- Avoid committing secrets or private runtime data.

## Implementation

- When `$implement` is invoked without a ticket, read [`implementation-backlog.md`](implementation-backlog.md) and select its current frontier ticket.
- For implementation tickets, follow the branch, commit, review, and pull-request workflow in [`implementation-backlog.md`](implementation-backlog.md). Use one ticket per branch and target `main`.

## Wayfinder

- The canonical map is [Plan the private-group personal assistant roadmap](https://github.com/f00faYka/personal-assistant/issues/37). Open that map directly when Wayfinder is invoked; do not search the repository's full issue list unless this pointer is unavailable or the map has been explicitly replaced.
- At Wayfinder startup, load the map body and child-issue relationship summaries first. Fetch an individual ticket body only after choosing the ticket; do not load every child issue by default.
- After each completed Wayfinder session, commit all tracked repository changes produced by that session before handing off.
- Use the resolved Wayfinder issue number as a zero-padded four-digit PASS prefix in the commit subject: `PASS-<issue number>: <summary>` (for example, issue 39 uses `PASS-0039`).
- If a Wayfinder session changes no tracked files, do not create an empty commit.
- At session end, provide a copy-paste continuation prompt containing the map's linked title and the next frontier ticket's linked title when one exists. Use this shape:

  `$wayfinder Continue [Plan the private-group personal assistant roadmap](https://github.com/f00faYka/personal-assistant/issues/37). Take [<next frontier ticket title>](<ticket URL>), or choose the first frontier ticket if none is named.`

- If the canonical map is closed or replaced, update this pointer in the same commit that establishes the replacement map.

## Git safety

- Never commit, push, or rewrite git history unless explicitly requested.
- Never perform destructive operations without explicit permission.
