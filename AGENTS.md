# Repository Guidelines

## Project Structure & Module Organization

Termix is a TypeScript app with a Vite/React frontend and Node/Electron backend.
Frontend code lives in `src/ui`: reusable UI in `components`, feature areas in
`features`, hooks in `hooks`, and API clients in `api`. Backend services, routes,
host integrations, and utilities live in `src/backend`; tests mirror this under
`src/backend/tests`. Script utilities and their tests live in `scripts`. Static
assets are in `public`, and Electron packaging code is in `electron`.

## Build, Test, and Development Commands

- `npm install`: install dependencies and run postinstall patch scripts.
- `npm run dev`: start the Vite frontend.
- `npm run dev:backend`: compile and run the backend from `dist/backend`.
- `npm run build`: build the frontend and backend for distribution.
- `npm run lint`: run ESLint across TypeScript sources.
- `npm run type-check`: run `tsc --noEmit`.
- `npm test`: run all Vitest projects once.
- `npm run test:coverage`: generate coverage in `coverage`.

For local app work, run `npm run dev` and `npm run dev:backend`; the frontend is
documented at `http://localhost:5174/`.

## Coding Style & Naming Conventions

Use TypeScript and follow existing module boundaries. Prettier enforces 2-space
indentation, semicolons, double quotes, trailing commas, LF endings, and an
80-column print width. Use `npm run format:check` or `npm run format` as needed.
ESLint rejects unused imports and enforces React Hooks rules; intentionally
unused variables should start with `_`.

Prefer kebab-case file names for modules, matching existing patterns such as
`host-key-verifier.ts` and `session-manager.test.ts`. React components should use
PascalCase exports. UI changes should use Tailwind CSS and existing shadcn/Radix
components where possible.

## Testing Guidelines

Vitest has three projects: backend tests run in Node, frontend tests run in
jsdom, and script tests run in Node. Name tests `*.test.ts` or `*.test.tsx` and
place them in `src/backend/tests`, `src/ui/tests`, or `scripts`. Add focused
tests for routes, repositories, crypto/security-sensitive utilities, and UI
helpers that change behavior.

## Commit & Pull Request Guidelines

Commitlint uses Conventional Commits. Use types such as `feat`, `fix`, `docs`,
`refactor`, `test`, and `chore`, for example `fix: preserve auth state`.
Pull requests should include a clear description, linked issues when applicable,
test results, and screenshots or recordings for visible UI changes.

## Security & Configuration Tips

Do not commit secrets, private keys, database files, certificates, or local
environment overrides. Be especially careful in SSH, Vault, OIDC, encryption,
tunnel, and file-manager code paths; include tests and note migration or
backward-compatibility risks in the PR.
