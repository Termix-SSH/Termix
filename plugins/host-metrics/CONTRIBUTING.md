# Contributing to Host Metrics

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

- **Metrics interval (seconds):** how often a host is checked while someone views it
- **History retention (days):** how long history is kept for the charts
- **Metrics on for new hosts:** whether new hosts start with metrics turned on

### User

- **Temperature unit:** Celsius or Fahrenheit

### Host

- **Collect metrics:** turn metrics on for this host
- **Metrics interval (seconds):** use a different interval for this host
- **Excluded mounts:** mount points or filesystem types to hide
- **Monitored paths:** extra paths to watch that are not separate mounts

## Permissions

- `host-metrics.use`: view metrics and use the manager cards. Admins and users have it by default.
