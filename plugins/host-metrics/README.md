# Host Metrics

Live CPU, memory, disk, network and process metrics, plus host management (services, packages, firewall, cron, users, SSL, logs, WireGuard). Other plugins add manager cards through the `host-metrics.managers` slot (Tailscale does).

The host list's online and offline dot is core's own status check, not this plugin. A working metrics login is what turns a reachable host online.

Bundled with Termix and enabled by default.

## Layout

    manifest.json        id, capabilities and what this plugin contributes
    src/backend/         activate(ctx) / deactivate(), the poller and the routes
    src/frontend/        the UI it registers
    src/shared/          types both sides use
    migrations/          adopts core's four metrics tables (sqlite, postgres, mysql)
    locales/en.json      its strings (English only; the rest are translated)
    tests/backend/       vitest, node
    tests/frontend/      vitest, jsdom

## Commands

    npm run build     bundle into dist/
    npm run test      run this plugin's tests
    npm run typecheck

See packages/plugin-sdk/ARCHITECTURE.md for the contract this follows.
