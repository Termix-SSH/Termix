# Tunnels

SSH port forwarding between servers, and client tunnels from the desktop app.

Bundled with Termix and enabled by default. It imports only
`@termix/plugin-sdk`.

## What it does

- **Server tunnels**: local, remote and dynamic (SOCKS5) forwards saved on a
  host, started from the Tunnels tab, the host editor or at boot when marked
  auto-start. A tunnel either rides the source host's connection alone, or
  opens a second SSH leg to a Termix endpoint host through a channel on the
  source connection.
- **Client tunnels**: the desktop app listens locally and relays each
  connection over `/plugin-ws/tunnels/c2s/stream`; presets of that list are
  saved per user.
- **`tunnels.access`**: a service other plugins call. `forward()` opens an
  on-demand forward and resolves once it works (web-endpoint uses it);
  `start`/`stop`/`status`/`list` work on saved tunnels by name (automations).

Both SSH legs go through `ctx.ssh.connect`, so tunnels get host key checks,
auth providers, proxies and jump hosts like every other transport. The
endpoint leg passes its forwardOut channel as `sock`.

## Layout

    manifest.json        id, capabilities and what this plugin contributes
    src/backend/         activate(ctx), the tunnel manager, routes, relay, service
    src/shared/          types and tunnel naming used by both bundles
    migrations/          one .sql per dialect, generated from src/backend/tables.ts
    src/frontend/        the tab, host editor section, rail panel and widget
    locales/en.json      its strings (English only; the rest are translated)
    tests/backend/       vitest, node
    tests/frontend/      vitest, jsdom

## Data

- `p_tunnels_presets`, adopted from core's `c2s_tunnel_presets`.
- Host settings `enableTunnel` and `tunnelConnections`, copied from the
  `ssh_data` columns of the same names by core's
  `tunnels-settings-migration.ts`.

See packages/plugin-sdk/ARCHITECTURE.md for the contract this follows.
