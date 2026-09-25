# Alerts

One inbox for every alert, with delivery to webhooks, ntfy, Discord and email.

Bundled with Termix and enabled by default. Any plugin sends through
`ctx.notify.send`; this plugin is the hub that stores and delivers them.

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
