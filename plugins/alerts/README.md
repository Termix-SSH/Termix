# Alerts

One inbox for every alert, with delivery to webhooks, ntfy, Discord and email.

## Features

- One inbox for alerts from every part of Termix.
- Popups for new alerts, filtered by severity.
- Channels that send alerts to webhooks, ntfy, Discord and email.
- Delivery rules that pick which alerts go to which channel.
- Optional news from the Termix team, like security notices and new releases.

## Settings

### Admin

- Termix announcements: show news from the Termix team in everyone's inbox.
- Keep alerts for (days): older alerts are removed from every inbox.
- SMTP server, port, TLS, username, password and from address: needed for email channels. Leave the server empty to turn email off.

### User

- Alert popups: all alerts, warnings and critical, critical only, or none.

## Permissions

- `alerts.use`: Get alerts in the inbox and send them to your own channels. Admins and users have it by default.

## For plugin authors

Send an alert from any plugin with `ctx.notify.send()`. This plugin stores it and delivers it. Do not build a separate notification system into a plugin.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
