# Contributing to Homepage

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

- **Allowed private hosts:** private or loopback addresses the Ping Status and Custom API widgets may reach. Empty blocks every private address
- **Private certificate authority (PEM):** an optional CA bundle trusted for those hosts

## Permissions

- `homepage.use`: view and edit the homepage and dashboard service links. Admins and users have it by default.
