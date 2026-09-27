# Tailscale

Browse and connect to devices on your tailnet, and handle Tailscale SSH sign-in checks.

## Features

- Browse the devices on your Tailscale or Headscale tailnet.
- Pick a device when adding a host to fill in its address.
- Shows the Tailscale SSH sign-in check when a host asks for it.
- Adds a Tailscale tool to Host Metrics.

## Settings

### Admin

- API key: a Tailscale or Headscale API key for your tailnet.
- API base URL: leave empty for Tailscale, or point it at a Headscale instance.
- Device list: check that the key works and see how many devices are reachable.

## Permissions

- `tailscale.devices.view`: See the devices on the tailnet. Only admins have it by default.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
