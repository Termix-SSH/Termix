# Contributing to Tunnels

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### Host

- **Enable tunnels:** set up SSH tunnels through this host
- **Tunnels:** the type, ports, endpoint host, auto start, max retries and retry interval for each tunnel

## Permissions

- `tunnels.use`: start, stop and watch tunnels, and save client tunnel presets. Admins and users have it by default.
