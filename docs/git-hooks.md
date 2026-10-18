# Local Git hooks

Run `npm ci` from the repository root to install dependencies and configure
Husky. Its `pre-commit` hook runs `npm run validate`, which runs:

- `npm run lint`
- `npm run typecheck`
- `npm run mobile:typecheck`
- `npm test`
- `npm run mobile:test`

If validation fails, Git stops the commit. This local hook does not enforce
validation on GitHub; GitHub Actions and a required check on `main` are tracked
separately in [issue #222](https://github.com/f00faYka/personal-assistant/issues/222).
