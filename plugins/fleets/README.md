# Fleets

Group hosts into fleets by static membership or tag rules, and run commands, package actions, and file transfers across every member at once.

Bundled with Termix and enabled by default.

## Layout

    manifest.json        id, capabilities and what this plugin contributes
    src/backend/         activate(ctx) / deactivate(), plus the routes
    src/frontend/        the UI it registers
    locales/en.json      its strings (English only; the rest are translated)
    tests/backend/       vitest, node
    tests/frontend/      vitest, jsdom

## Commands

    npm run build     bundle into dist/
    npm run test      run this plugin's tests
    npm run typecheck

See packages/plugin-sdk/ARCHITECTURE.md for the contract this follows.
