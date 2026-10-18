# Linting

Run `npm run lint` from the repository root to lint API and mobile TypeScript
and TSX source and test files. To check one workspace, run
`npm run lint --workspace @personal-assistant/api` or
`npm run lint --workspace @personal-assistant/mobile`.

The shared ESLint flat configuration applies the TypeScript recommended rules
to both workspaces and React Hooks rules to mobile code.
