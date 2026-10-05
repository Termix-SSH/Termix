# Contributing to Usage Statistics

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

- **Share anonymous usage statistics:** turn the daily report on or off
- **Include platform info, Include feature usage and Include installed features:** choose what the report includes

### User

- **Include my feature usage:** count which kinds of tabs you open in the report

## Permissions

- `telemetry.manage`: see what is sent, send it now and reset the instance ID. Only admins have it by default.
