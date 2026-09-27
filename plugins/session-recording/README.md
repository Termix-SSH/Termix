# Session Recording

Record terminal sessions and play them back or download them later.

## Features

- Records SSH terminal sessions as they happen.
- Play a recording back, skip through it and copy its text.
- Download a recording as a file or as plain text.
- Removes recordings older than a set number of days.
- Keeps recordings when a user is deleted, with the user's name removed.

## Settings

### Admin

- Retention (days): remove recordings older than this. Checked at startup and once a day.

### Host

- Enable session recording: record sessions on this host.

## Permissions

- `session-recording.view`: View and download session recordings. Admins and users have it by default.

## Services

Provides to other plugins:

- `recordings.writer`: start a recording and add to it as a session runs, or save a recording that is already finished.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
