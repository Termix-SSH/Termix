# Contributing to Tailscale

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### Admin

- **API key:** a Tailscale or Headscale API key for your tailnet
- **API base URL:** leave empty for Tailscale, or point it at a Headscale instance
- **Device list:** check that the key works and see how many devices are reachable

## Permissions

- `tailscale.devices.view`: see the devices on the tailnet. Only admins have it by default.
