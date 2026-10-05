# Contributing to Session Sharing

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

- **Allow Session Sharing:** turn sharing on or off for everyone. When off, it overrides every host setting

### Host

- **Allow Session Sharing:** allow sharing sessions on this host

## Permissions

- `session-sharing.use`: share sessions and create and join meeting rooms. Admins and users have it by default.
