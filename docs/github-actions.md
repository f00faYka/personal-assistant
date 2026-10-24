# GitHub Actions merge gate

The `CI` workflow runs the repository validation on every pull request targeting
`main` and every push to `main`. Its `Validate` job uses Node.js 24, installs
from `package-lock.json` with `npm ci`, then runs lint, API and mobile
typechecks, and API and mobile tests.

The stable required status check is **`CI / Validate`**. Configure the `main`
branch protection rule to require this check before merging. Enable the rule for
administrators and repository owners, leave the bypass list empty, and keep the
repository private. Without the rule, Actions reports results but does not
prevent merges.

Local Husky validation is a contributor convenience; the required GitHub
status check is the server-side merge gate.
