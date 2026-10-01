# Web Endpoint

Open a host's web UI in a tab or a separate desktop window, directly or over an SSH tunnel.

## Features

- Open a host's web UI in a tab or a separate desktop window.
- Connect directly, or over an SSH tunnel when the web UI is only reachable from the host.
- Up to 16 endpoints per host.

## Setup

Each endpoint is one of two kinds:

- Direct: your browser loads `scheme://host:port/path` itself.
- Tunnel: Termix opens an SSH tunnel to the port and loads it from there. Unused tunnels close after ten minutes.

Tunnel endpoints need the Tunnels plugin.

## Settings

### Host

- Enable web endpoints and the list of endpoints for this host.

## Services

Uses from other plugins:

- `tunnels.access` to open tunnels. Required.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
