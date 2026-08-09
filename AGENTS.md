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
