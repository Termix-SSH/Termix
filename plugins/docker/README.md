# Docker

Container management over SSH: list, inspect, start, stop and view logs for Docker or Podman containers, plus an interactive container console.

Bundled with Termix and enabled by default.

## Services

- `docker.containers` 1.0.0: `listContainers(hostId, { all? })` and
  `action(hostId, container, "start" | "stop" | "restart" | "pause" |
"unpause" | "remove")`, run over a pooled SSH connection as the caller.
- `docker.events` 1.0.0: `subscribe(hostId, listener)` calls the listener
  with `{ hostId, container, event }` when a container exits, starts,
  restarts or turns unhealthy, polled about once a minute as the caller.
  Subscribing the same listener again is a no-op.

Both need `docker.use`.

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
