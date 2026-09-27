# Remote Desktop

RDP, VNC and Telnet sessions in the browser, with clipboard, file transfer, recording and sharing.

## Features

- Connect to hosts over RDP, VNC or Telnet from any browser.
- Clipboard sync and file transfer through RDP drive redirection.
- Session recording and session sharing, when those plugins are on.
- Jump host support.
- Opens the Windows Remote Desktop client from the desktop app.

## Setup

This plugin needs guacd, the Apache Guacamole proxy that speaks RDP, VNC and Telnet. The Docker compose file runs it as its own `guacamole/guacd` container. This plugin never starts guacd itself.

Set where guacd runs with the guacd URL admin setting. The `GUACD_URL`, or `GUACD_HOST` and `GUACD_PORT`, environment variables override that setting.

Other environment variables:

| Variable                       | What it sets                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `GUACD_TUNNEL_HOST`            | The name guacd uses to reach Termix for a jump host tunnel. Defaults to `termix`. |
| `GUACD_RECORDING_PATH`         | Where guacd writes recordings, as guacd sees it.                                  |
| `GUACD_RECORDING_BACKEND_PATH` | The same folder, as Termix sees it.                                               |
| `GUACD_DRIVE_PATH`             | The root of each user's RDP drive folder on the guacd host.                       |
| `GUACAMOLE_ENCRYPTION_KEY`     | The connection token key. Made from `JWT_SECRET` when not set.                    |

## Settings

### Admin

- Enable Remote Desktop: turn remote desktop on or off.
- guacd URL: where guacd runs, as `host:port`. Changes apply without a restart.

### User

- RDP defaults: color depth, resize method, wallpaper, font smoothing, audio, printing, drive redirection and clipboard. A host's own values win over these.

### Host

- RDP, VNC and Telnet: turn each protocol on and set its port.
- RDP security mode and Ignore certificate errors.
- guacd settings: every other guacd option.
- Remote desktop toolbar: show the toolbar in the session.

## Permissions

- `remote-desktop.sessions`: Let session sharing and recording reach your remote desktop sessions. Admins and users have it by default.

## Services

Provides to other plugins:

- `sessions.live` as `rdp`, `vnc` and `telnet`: find a live session so it can be shared.

Uses from other plugins:

- `recordings.writer` to record sessions. Optional.
- `tunnels.access` for single-hop jump host tunnels. Optional.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
