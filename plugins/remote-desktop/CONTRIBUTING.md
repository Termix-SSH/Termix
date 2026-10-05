# Contributing to Remote Desktop

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

- **Enable Remote Desktop:** turn remote desktop on or off for everyone
- **guacd URL:** where guacd runs, as `host:port`. Changes apply without a restart

### Host

- **RDP, VNC and Telnet:** turn each protocol on and set its port
- **Display, audio, device and performance options:** values left alone follow the host defaults
- **guacd settings:** use a different guacd for this host
- **Remote desktop toolbar:** show the toolbar in the session

## Permissions

- `remote-desktop.sessions`: let session sharing and recording reach your remote desktop sessions. Admins and users have it by default.
