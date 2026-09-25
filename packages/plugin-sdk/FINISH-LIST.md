# Finish list

Everything a Phase B/C step left for D0 is done. What is left needs a person
with a real install, a real device or a repo outside this one.

## Manual checks after 2.9.0

- SSH terminal: password auth, key auth (and an encrypted key's passphrase
  prompt), TOTP keyboard-interactive, a jump host, Warpgate, split view,
  snippets sent to a terminal, reconnect after a network drop and after a
  page reload (session reattach), and the local terminal in the desktop app.
- Serial: the Electron backend path against a real device path/COM port, and
  the Web Serial browser picker in Chrome or Edge.
- Session sharing: a link share (read-only and read-write) opened in a private
  window, a user share joined from Active Connections, revoke and "end for
  everyone", and a collab room with two members, control hand-off, a guest
  link, rotate and end.
- Session recording: an SSH session recorded end to end (playback matches what
  happened, including a resize mid-session), a host with recording switched
  off records nothing, retention prunes an old recording on schedule, a guacd
  RDP/VNC/Telnet recording still gets a row and plays back, and deleting a
  user anonymizes their recordings instead of removing them.
- Host status and metrics: on a 2.8 database, hosts whose status checks were
  off stay off and a custom interval survives; the host list dot goes
  reachable, then online once the Host Metrics tab or a terminal logs in;
  an RDP-only host on a custom port shows online; the metrics tab, the
  dashboard host bars, the homepage host status widget, the metrics chart
  widget, the terminal toolbar bars and the file manager's disk bar; a
  manager card (services, packages) and a health check; TOTP on the metrics
  connect; the admin metrics interval, history retention and new-host default;
  the temperature unit; disabling host metrics leaves every other plugin's
  SSH working, then enabling it again.
- Remote desktop: an RDP, a VNC and a Telnet host; a host behind one jump
  host (tunnels plugin on and off) and behind a chain of two; macOS Screen
  Sharing over VNC with no username; RDP recording (and none with
  session-recording off or the host's switch off); file transfer through the
  RDP drive, drag and drop included; clipboard both ways; sharing an RDP
  session by link (read-only and read-write) and presenting it in a collab
  room; opening Windows Remote Desktop from the desktop app on Windows;
  changing the guacd URL in admin settings without a restart; turning Remote
  Desktop off in admin (actions disappear, connects answer 403); a 2.8 host
  that only had `connection_type = rdp` comes up as RDP with SSH off; RDP user
  defaults apply to a saved host; Quick Connect over RDP and VNC; the desktop
  app with a host on the remote server and one on This device.
- Docker: a 2.8 host with Docker on (and one on Podman) keeps its switch and
  runtime; list, start, stop, logs, stats and the console on a Linux host;
  TOTP (including a wrong code first) and Warpgate on the connect; a host
  with no stored password asks for credentials; the homepage Docker widget;
  an automation Docker step and a `docker_event` trigger; disable Docker with
  a console open, then enable it and open another.
- Automations: on a 2.8 database the automations, their run history and
  their channel links are there; a schedule fires; a webhook fires on both
  `/plugin-api/automations/webhook/<token>` and the old
  `/automations/webhook/<token>`; a metric threshold on a host nobody has
  open still fires (headless viewers); a `docker_event` trigger and a Docker
  step; a notify step to webhook, ntfy and Discord channels, and to a LAN
  ntfy with the private opt-in plus the admin allowlist; disable Docker and
  the automation shows "Needs docker", its scheduled runs are recorded as
  skipped and the others keep running, then enable it again; the AI
  assistant lists and creates automations, and says they are unavailable
  with automations off.
- Homepage: on a 2.8 database every widget, its layout and every service
  link are there; add, move, resize, edit and delete a widget of each type;
  the favicon, RSS, ping and custom API widgets against a real remote URL,
  and each refuses a private/loopback target; the dashboard's Service
  Links and Homepage Preview cards; the Dashboard/Homepage toggle and its
  copy-link and open-full-view buttons; `?view=homepage`; docker's, tunnels'
  and file-manager's own homepage widgets still work with the homepage
  plugin disabled; the AI assistant lists homepage items and says
  unavailable with homepage off; disable homepage in admin (the tab, its
  dashboard cards and the toggle disappear) then enable it again.
- TOTP and passkeys: on a 2.8 database a TOTP user is still asked for a
  code (and a backup code works once); set up TOTP from Settings > Security,
  add a second device, regenerate backup codes, disable it; enabling signs
  out other sessions; "remember me" skips it next time; disable the totp
  plugin and a TOTP user's login is refused until an admin resets their
  factors; register a passkey, sign in with it with and without a PIN (no
  PIN still asks for TOTP), delete it; existing 2.8 passkeys still sign in.
- SSO and LDAP: on a 2.8 database every SSO provider and LDAP directory is
  there, in Settings > Plugins > Single sign-on and > LDAP; an existing
  provider still signs in through its identity provider without changing
  anything there (its redirect URI shows `/users/oidc/callback`); add the
  new redirect URI at the provider, switch it over and sign in again; a new
  provider, GitHub and Google; an existing SSO user and an existing LDAP
  user land in their old accounts; the env-configured provider; admin group
  and role map; back-channel logout from Keycloak ends the session; the
  desktop app's system browser login and Termix-Mobile's login; silent
  sign-in; a second factor after an external login with the admin setting
  on and off; disable each plugin and its buttons go away and its URLs stop
  signing anyone in, then enable it again.
- OPKSSH and Warpgate: on a 2.8 Docker install with OPKSSH set up, the config
  shows up under the plugin, the admin page shows the old redirect URI and a
  terminal sign-in to an OPKSSH host works through the provider chooser
  without touching the identity provider; switch to the new URI, register
  it and sign in again; a second connect within 24 hours skips the browser;
  an offline Docker install uses the baked binary; disable the opkssh plugin
  and the host says it needs it. A Warpgate host's toggle is on in the host
  editor's Plugins group after the upgrade, and the terminal, file manager
  and docker each show the sign-in dialog and connect after it.
- Vault: on a 2.8 database every Vault profile is there and each Vault host
  still has its profile selected in the host editor; the admin page shows the
  old redirect URI; a terminal connect opens Vault's sign-in, signs a
  certificate and connects, and a second connect skips the browser until the
  certificate expires; create, edit, share and delete a profile from the host
  editor (sharing only offered with "Share Vault profiles"); switch to the new
  redirect URI after allowing it in the Vault role; disable the vault plugin
  and a Vault host says it needs it, then enable it again.
- Termix-Mobile: the 2.8 termix-id management routes (`/termix-id/me`,
  `/termix-id/keys`, `/termix-id/ca` and the rest) now 404, only the
  `/termix-id/u/` resolver redirects. Confirm the mobile app does not call
  them, and that it still reads a host's metrics settings (`statsConfig` is
  put back on the host payload by host-metrics) and the renamed Warpgate
  fields. Once it reads `pluginSettings` and `GET /host/status`, drop
  host-metrics's `hostPayloadLegacy` hook.
- Docs site: point these at the plugins: the OPKSSH config path and redirect
  URI, the step-ca settings, the Vault redirect URI, the Termix ID resolver
  URL (`/plugin-api/termix-identity/u/<handle>`, the old one still 308s) and
  the HTTPS certificate page (`docs.termix.site/features/networking/ssl`,
  which still describes certbot and the webroot challenge).
- Upgrade a real 2.8 install on Postgres and on MySQL (SQLite is covered by
  the upgrade test): proxmox host settings, tunnels, web endpoints, the file
  manager's default path and SCP switch, and the terminal, tmux, sharing and
  recording switches all survive. Postgres was checked by hand against a
  scratch database; MySQL only runs in CI.
- Host settings round trip: filter the Hosts panel by a plugin feature, bulk
  enable and disable a plugin on a few hosts, export hosts to JSON and import
  them on another install (plugin settings come across, secrets do not), the
  raw SQLite export and import, and remote sync of a host with a Vault
  profile selected (the profile follows it).
- Desktop app with a remote server: tunnels on a remote host show their
  status next to local ones, and the terminal toolbar's metrics bars work
  for a host on the remote server.
- Shared hosts: a remote desktop host shared at "connect" does not show its
  gateway settings; a shared editor cannot change a Vault host's profile; the
  host list status dot works for a host someone shared with you.
- The PDF preview in the file manager, in the browser and in the desktop app.
- The tab right-click menu's share entry on a terminal whose toolbar is
  hidden, and the terminal toolbar's quick links (tmux monitor, docker,
  tunnels, host metrics) for a host with those plugins on.
- Appearance: switching the interface preset changes the Docker layout and
  the host metrics column count, a change made in either shows under
  Appearance with the plugin's name and reverts from there, and a 2.8 user's
  Docker and host metrics overrides are still applied.
- A new host takes the admin "command history for new hosts" setting (a 2.8
  install that had it off in host defaults keeps it off), and the file
  manager and terminal are on for a new host.
- Settings saves with a bad value are refused with a message: a relative
  terminal background image path, a step-ca URL that is not https.
- Custom `SSL_CERT_PATH` and `SSL_KEY_PATH` in the environment survive a
  restart and no self-signed certificate is generated over them.
- A LAN ntfy or webhook target in the admin allowlist is reached through the
  configured outbound proxy.
- An admin enables a plugin that was off since the upgrade: its 2.8 data is
  copied in without a restart.
- A password user who signs in for the first time after the upgrade keeps
  their TOTP (the copy runs once their keys unlock).
