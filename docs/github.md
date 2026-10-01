# GitHub tracker access

Use this guide for every task that names a GitHub issue, pull request, or repository tracker item.

## Preconditions

1. Check the account in the same execution context that will make the request:

   ```sh
   gh auth status --hostname github.com
   ```

   In Codex, the ordinary sandbox may both lack DNS access to `api.github.com` and expose a stale credential view. Run the status check and the issue query together through the approved network path; do not treat a sandbox-only generic error as proof that the token or issue is invalid.

2. Use the repository explicitly for issue commands:

   ```sh
   gh issue view <number> --repo f00faYka/personal-assistant --json number,title,state,body,labels,assignees,url
   ```

3. GitHub CLI reads `GH_TOKEN` or `GITHUB_TOKEN` automatically. It does not automatically read `GITHUB_PAT_TOKEN`. For a one-off command, map the already-provided value without printing it:

   ```sh
   GH_TOKEN="$GITHUB_PAT_TOKEN" gh issue view <number> --repo f00faYka/personal-assistant
   ```

   Prefer `gh auth login --hostname github.com --with-token` to repair the local Keychain when the stored account is invalid. Never print, paste into repository files, or commit a token.

4. An unauthenticated request to this private repository can return `404` for an existing issue. Treat that as an access failure until authentication is verified.

5. Codex sandbox commands can report `Could not resolve host: api.github.com` or `gh`'s generic `error connecting` because network access is disabled there. Do not infer that an issue is missing. Use the connected GitHub MCP when available; otherwise run the read-only auth check and `gh` command together through the approved network path.

   The verified recovery pattern for this workstation is:

   ```sh
   GH_TOKEN="$GITHUB_PAT_TOKEN" gh auth status --hostname github.com
   GH_TOKEN="$GITHUB_PAT_TOKEN" gh issue view <number> --repo f00faYka/personal-assistant --json number,title,state,body,labels,assignees,url
   ```

   If both commands are run outside the sandbox, the token identifies `f00faYka` and private issues are readable. If the stored Keychain credential is repaired, the explicit `GH_TOKEN` mapping is still safe and makes the credential source unambiguous.

## Read-before-action sequence

- Read the live issue body, state, labels, and relevant comments before forming a plan or changing code.
- If the issue cannot be read after the auth and network checks, stop and ask for access or the issue body. Do not invent requirements from the issue number, nearby code, or an old snapshot.
- Keep tracker writes separate from reads. Assigning, commenting, editing, closing, merging, and pushing require explicit user authorization; verify each completed write with a fresh read.
- Re-query state immediately before any action that depends on open/closed status, dependencies, branch state, or current issue content.
