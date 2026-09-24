# Remote Desktop

RDP, VNC and Telnet sessions over guacd, with clipboard, file transfer through
RDP drive redirection, session recording and session sharing.

## guacd

guacd (the Apache Guacamole proxy daemon that speaks RDP, VNC and Telnet) is an
external service this plugin talks to over TCP. The stock Docker compose runs
it as its own `guacamole/guacd` container. This plugin never starts it.

Where to find it is the admin setting **guacd URL** (`host:port`). The
`GUACD_URL`, or `GUACD_HOST` and `GUACD_PORT`, environment variables override
the setting, so a compose file stays the source of truth where it sets them.
Changing the setting rebuilds the connection server without a restart.

Other environment variables the plugin reads:

| Variable                       | What it sets                                                                |
| ------------------------------ | --------------------------------------------------------------------------- |
| `GUACD_TUNNEL_HOST`            | The name guacd uses to reach Termix for a jump host tunnel (default termix) |
| `GUACD_RECORDING_PATH`         | Where guacd writes recordings, as guacd sees it                             |
| `GUACD_RECORDING_BACKEND_PATH` | The same folder as Termix sees it                                           |
| `GUACD_DRIVE_PATH`             | The root of each user's RDP drive folder on the guacd host                  |
| `GUACAMOLE_ENCRYPTION_KEY`     | The connection token key; derived from `JWT_SECRET` when unset              |

## Settings

- **Admin**: turn Remote Desktop on or off, and the guacd URL.
- **User**: RDP defaults (colour depth, resize method, wallpaper, clipboard
  and the rest). A host's own values win; anything a host leaves on its
  default takes the user's.
- **Host**: the RDP, VNC and Telnet switches, ports, security mode,
  certificate handling and every guacd parameter, edited in the host
  editor's RDP, VNC and Telnet tabs. The toolbar switch is in the Plugins tab.

The logins (users, passwords, stored credentials, domain) stay on the host in
core, because sharing decides which of them a recipient may use.

## Capabilities

- `credentials:read`: guacd needs the host's RDP, VNC or Telnet password in
  plain text, so the plugin reads it through `ctx.credentials`. A shared
  recipient only ever gets the owner's shared snapshot or their own override.
- `ssh:connect`, `credentials:use`: jump host tunnels, through
  `ctx.ssh.jumpChain`, or the tunnels plugin's `tunnels.access` for a single
  hop when it is running.
- `network:serve`: the routes and the `/display` socket.
- `desktop:window`: opening the Windows Remote Desktop client from the desktop
  app.
- `hosts:read`: the online indicator while a session is open.
- `ui:surface`: everything the frontend registers.

## Services

Provides `sessions.live` under the names `rdp`, `vnc` and `telnet`, which is
how session sharing and collab rooms find a live session and mint a viewer
token for it. Uses `recordings.writer` (session-recording) to decide whether
to record and to list finished recordings, and `tunnels.access` (tunnels)
for single-hop jump tunnels. Both are optional.
