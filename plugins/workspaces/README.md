# Workspaces

Save and restore named tab/split layouts per user.

Bundled with Termix and enabled by default. This is the reference
conversion: it imports only `@termix/plugin-sdk`, and "Converting a feature
into a plugin" in packages/plugin-sdk/ARCHITECTURE.md points here for each step.

## Layout

    manifest.json        id, capabilities and what this plugin contributes
    src/backend/         activate(ctx), the table, repository and routes
    migrations/          one .sql per dialect, generated from src/backend/tables.ts
    src/frontend/        the UI it registers
    locales/en.json      its strings (English only; the rest are translated)
    tests/backend/       vitest, node
    tests/frontend/      vitest, jsdom

## Commands

    npm run build     bundle into dist/
    npm run test      run this plugin's tests
    npm run typecheck
    npx termix-plugin migrations <name>   after changing src/backend/tables.ts

See packages/plugin-sdk/ARCHITECTURE.md for the contract this follows.
