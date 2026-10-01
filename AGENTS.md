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

## GitHub tracker access

- For any task that names a GitHub issue, pull request, or tracker item, first read [GitHub tracker access](docs/github.md). Verify live auth and network access before reading; if the issue remains inaccessible, ask for access or its body instead of inferring requirements.

## Local development in Herdr

- Before starting, restarting, or stopping application services, read [backend runtime setup](docs/backend.md) and [mobile launch modes](docs/mobile.md). Check current `package.json` scripts and `.env.example`; use local `.env` values without copying secrets into output or documentation.
- Run long-lived services in visible panes in the current Herdr workspace's `run` tab. Keep the agent pane available for work; use short-lived tool commands for tests and checks. Discover `HERDR_ENV`, `HERDR_WORKSPACE_ID`, and current tabs/panes; use `herdr --skill` for CLI instructions. If no Herdr workspace is available, report that limitation before choosing another persistent terminal.
- Before reusing a service, inspect its pane with `herdr pane process-info --pane <pane-id>` and check its endpoint. Confirm the checkout, port, and real/fixture mode match the task; a pane label alone is insufficient. Discover pane IDs and LAN addresses each session.
- Start only the components needed for the task. Commands below run from the repository root:

  | Task | Command |
  | --- | --- |
  | Complete local audio-to-result workflow | `npm run dev:all` |
  | Complete workflow on a physical iPhone over Wi-Fi | `npm run dev:all -- --lan` |
  | API only | `npm run dev` |
  | Real native client / real browser client | `npm run mobile:start` / `npm run mobile:web` |
  | UI fixture on native / browser | `npm run mobile:fixture` / `npm run mobile:web:fixture` |

- For the complete workflow, run the launcher in a visible Herdr pane and let it manage the service panes and readiness order. It validates configuration, reuses ready Ollama/Whisper services, and starts API/Expo after AI readiness. Keep the launcher alive for cleanup. Prefer a 2×2 service layout when creating a fresh `run` tab; preserve existing user panes.
- For individual components, create or reuse a dedicated, clearly labelled pane with the correct working directory. Real clients need a reachable API; audio processing also needs the configured AI runtimes. UI fixtures need only Expo and must remain explicitly selected for that session.
- For an explicit Expo web LAN port, run `npx expo start --web --lan --port <port>` from `apps/mobile`; set `EXPO_PUBLIC_UI_FIXTURE=true` only for a fixture session. Root npm argument forwarding can misinterpret the port as a project path. Use the Mac's reachable LAN API URL for a physical phone, following the mobile setup guide.
- Before reporting readiness, verify the requested components: configured Ollama/Whisper health endpoints and Ollama model availability, API `/health`, Expo `/status`, and the requested client screen when accessible. Report any unverified device access separately.
- Record which panes/processes this invocation starts. Stop the full stack with Ctrl+C in its launcher; stop individually started services with Ctrl+C in their owned panes. Preserve reused services and unrelated panes. Hand off the mode, URL/port, pane IDs, readiness results, and exact stop instruction.

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
