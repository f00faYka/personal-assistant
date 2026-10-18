# Continuous integration

The `Repository validation` GitHub Actions workflow runs on every pull request
targeting `main` and on every push to `main`. Its stable required status check
is named **Validation**.

The job uses Node.js 24, installs the committed lockfile with `npm ci`, and
passes only when all of these commands pass:

- `npm run lint`
- `npm run typecheck`
- `npm run mobile:typecheck`
- `npm test`
- `npm run mobile:test`

The `main` branch merge gate must require the **Validation** status check,
include administrators, and allow no bypass. A pull request must not merge
until this check succeeds.
