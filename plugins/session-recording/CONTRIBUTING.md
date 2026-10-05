# Contributing to Session Recording

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

- **Retention (days):** remove recordings older than this. Checked at startup and once a day

### Host

- **Enable session recording:** record sessions on this host

## Permissions

- `session-recording.view`: view and play back your own session recordings. Admins and users have it by default.
