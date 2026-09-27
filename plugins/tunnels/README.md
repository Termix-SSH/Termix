# Tunnels

SSH port forwarding between servers, plus local tunnels from the desktop app.

## Features

- Local, remote and dynamic (SOCKS5) SSH tunnels saved on a host.
- Start tunnels from the Tunnels tab or the host editor, or on boot.
- Route a tunnel through a second host.
- Local tunnels from the desktop app, with saved presets.
- Adds a tunnels widget to the homepage.

## Settings

### Host

- Enable tunnels and the list of saved tunnels for this host.

## Permissions

- `tunnels.use`: Use tunnels. Admins and users have it by default.

## Services

Provides to other plugins:

- `tunnels.access`: open a tunnel on demand, or start, stop and check saved tunnels.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
