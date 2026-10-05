# Contributing to Alerts

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

- **Termix announcements:** show news from the Termix team in everyone's inbox
- **Keep alerts for (days):** older alerts are removed from every inbox
- **SMTP server, port, TLS, username, password and from address:** needed for email channels. Leave the server empty to turn email off

### User

- **Alert popups:** all alerts, warnings and critical, critical only, or none

## Permissions

- `alerts.use`: get alerts in the inbox and send them to your own channels. Admins and users have it by default.
