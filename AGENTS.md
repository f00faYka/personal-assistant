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

## Wayfinder

- After each completed Wayfinder session, commit all tracked repository changes produced by that session before handing off.
- Use the resolved Wayfinder issue number as a zero-padded four-digit PASS prefix in the commit subject: `PASS-<issue number>: <summary>` (for example, issue 39 uses `PASS-0039`).
- If a Wayfinder session changes no tracked files, do not create an empty commit.

## Git safety

- Never commit, push, or rewrite git history unless explicitly requested.
- Never perform destructive operations without explicit permission.
