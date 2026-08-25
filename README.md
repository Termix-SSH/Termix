<div align="center">

<img src="./public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Self-hosted server management, from SSH and remote desktop to automations</p>

<p>
  English ·
  <a href="docs/readme/README-CN.md">中文</a> ·
  <a href="docs/readme/README-JA.md">日本語</a> ·
  <a href="docs/readme/README-KO.md">한국어</a> ·
  <a href="docs/readme/README-FR.md">Français</a> ·
  <a href="docs/readme/README-DE.md">Deutsch</a> ·
  <a href="docs/readme/README-ES.md">Español</a> ·
  <a href="docs/readme/README-PT.md">Português</a> ·
  <a href="docs/readme/README-RU.md">Русский</a> ·
  <a href="docs/readme/README-AR.md">العربية</a> ·
  <a href="docs/readme/README-HI.md">हिन्दी</a> ·
  <a href="docs/readme/README-TR.md">Türkçe</a> ·
  <a href="docs/readme/README-VI.md">Tiếng Việt</a> ·
  <a href="docs/readme/README-IT.md">Italiano</a>
</p>

<p>
  <img src="https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release&color=F39044&labelColor=1a1a1a&v=1" />
  <a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720?color=F39044&labelColor=1a1a1a" /></a>
  <a href="https://donate.termix.site/"><img alt="Donate" src="https://img.shields.io/badge/Donate-Support%20Termix-F39044?style=flat&labelColor=1a1a1a" /></a>
</p>

<p>
  <a href="https://donate.termix.site/"><img alt="Donations this month" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=Donations%20this%20month&query=%24.fiatTotal&prefix=%24&url=https%3A%2F%2Ftermix.site%2Fdonation-snapshot.json&color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

Termix is free and open source. If you find it useful, consider [donating](https://donate.termix.site/) to help cover server costs and development time.

<br />

<img src="./docs/repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="docs/repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Achieved on September 1st, 2025</sub>
</p>

</div>

<br />

## Overview

Termix is a free, open source, self-hosted platform for managing your servers. It puts SSH terminals, remote desktops (RDP, VNC, Telnet), file transfers, tunnels, Docker, metrics, and automations in one place, on web, desktop, and mobile. It is a self-hosted alternative to Termius that stays free forever.

<br />

## Features

<table>
<tr>
<td width="50%" valign="top">

**SSH Terminal:**
A full terminal with browser-like tabs and split screen, up to 6 panels at once. Pick your theme, font, and colors. A toolbar sits above each session with live CPU, memory, and disk, plus quick links to that host's files, Docker, tunnels, and metrics.

</td>
<td width="50%" valign="top">

**Remote Desktop:**
RDP, VNC, and Telnet in the browser, in tabs and split screen like any other session. Includes a file browser for RDP drives and drag-and-drop upload. On Windows desktop you can also open a host in the native RDP client.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH Tunnels:**
Local, remote, and dynamic SOCKS forwarding with auto reconnect and health checks. Client-to-server tunnels on the desktop app are stored on that machine, and you can save presets to the server to move a setup to another client.

</td>
<td width="50%" valign="top">

**File Manager:**
Browse, edit, upload, download, rename, move, and delete files over SFTP, with sudo support. View and edit code, images, audio, and video. Copy files straight from one server to another, with the fastest route picked for you and transfers checked for integrity.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker and Podman:**
Start, stop, pause, and remove containers, watch their stats, and open a shell inside one. Works with both Docker and Podman. It is not meant to replace Portainer or Dockge, just to manage containers you already have.

</td>
<td width="50%" valign="top">

**Host Manager:**
Save and organize hosts with tags and nested folders you can name and color. Reuse saved credentials across hosts, deploy SSH keys automatically, group hosts under a parent host, bulk edit and export, and use Quick Connect for one-off connections you do not want to save.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Host Metrics:**
CPU, memory, disk, network, temperature, uptime, processes, ports, logins, and system info on most Linux servers, with history graphs. Manager cards let you handle services, cron jobs, packages, users, firewall rules, WireGuard, Tailscale, SSL certs, logs, and health checks without leaving Termix.

</td>
<td width="50%" valign="top">

**Automations:**
Pick a trigger, then say what should happen. Triggers include a metric crossing a threshold, a host going up or down, a health check changing, a schedule, a container event, or an incoming webhook. Steps can run commands and snippets, control containers and tunnels, wake a host, call a URL, wait, branch on a condition, run another automation, and notify you over ntfy, Discord, or a webhook. Test runs let you try it safely first.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Fleets:**
Group hosts into a fleet by picking them or with tag rules, so new hosts join on their own. Run one command on every host at once, push and pull files across all of them, install packages, and collect an inventory of OS, kernel, arch, and uptime.

</td>
<td width="50%" valign="top">

**AI Assistant:**
Optional, and off until you turn it on. Connect OpenAI, Anthropic, Gemini, Ollama, or any OpenAI compatible endpoint and ask about your setup. It reads hosts, fleets, snippets, and alerts, and proposes changes for you to approve instead of making them. It can never touch credentials, users, or settings. Admins can leave it off for the whole instance, and you can hide it during setup.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Login and Users:**
Local accounts plus OIDC, LDAP, GitHub, and Google sign-in, with 2FA (TOTP), passkeys (WebAuthn), and trusted devices. Admins can manage users, map OIDC groups to roles, see every active session across platforms, and revoke them. Link your local and OIDC accounts together, and read the audit log of what everyone did.

</td>
<td width="50%" valign="top">

**Roles and Sharing:**
Create roles and share hosts with users or roles at four levels: connect, view, edit, and manage. Works with every auth type and every protocol, and you can override the credentials used for a shared host.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Alerts:**
Set rules on host metrics like CPU, memory, and disk, and get notified over ntfy, Discord, or a webhook when they fire. See firing and resolved alerts in a history log, and dismiss the ones you do not care about.

</td>
<td width="50%" valign="top">

**Homepage:**
A drag-and-drop widget grid you build yourself. Widgets for host status, pings, service links, bookmarks, search, clocks, calendars, countdowns, notes, RSS, weather, images, iframes, Docker, tunnels, metrics charts, custom APIs, and even a live terminal.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Snippets and Tools:**
Save commands you run often and fire them off in one click, with variables for the host and your own inputs. Run a single command across every open terminal, and search your command history with autocomplete.

</td>
<td width="50%" valign="top">

**Session Sharing:**
Share a live terminal, RDP, VNC, or Telnet session in real time. Send a link anyone can join without an account, or share with a specific Termix user, in read-only or read-write mode. Shares can expire on their own or be revoked, and can be turned off globally or per host.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Session Recording and Logs:**
Record terminal, RDP, and VNC sessions and play them back later. Download plain text logs of a session, and check the connection log to see exactly what happened during a connection.

</td>
<td width="50%" valign="top">

**Serial Connections:**
Talk to serial devices like routers, switches, and microcontrollers from the browser or desktop app. Set baud rate, data bits, stop bits, and parity. Uses the Web Serial API in supported browsers, or a native backend in the desktop app.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Pull devices from your tailnet to add them as hosts in a couple of clicks, and connect with Tailscale SSH so your tailnet ACLs handle access and no credentials are stored. Headscale and custom endpoints work too.

</td>
<td width="50%" valign="top">

**Proxmox:**
Import hosts straight from a Proxmox instance, and watch node and guest stats, including CPU, memory, and storage, in their own tab.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Workspaces and Tabs:**
Save a set of tabs with their split layout and reopen the whole thing in one click. Termix also remembers your last session, so your tabs come back across refreshes and devices.

</td>
<td width="50%" valign="top">

**Guided Setup:**
A short setup walks you through picking an interface preset, your theme, the features you want, and your first host. Simple mode hides what you do not use, and you can rerun setup or switch presets any time.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Desktop Standalone and Sync:**
The desktop app runs on its own with a local backend and database, no server needed. You can also connect it to a Termix server for two-way sync of hosts, credentials, snippets, and more, and choose whether connections start locally or through the server.

</td>
<td width="50%" valign="top">

**Command Line Interface:**
A `termix` CLI for your shell and your scripts. Open terminals, run a command on one host or a whole fleet, move files over SFTP, and manage hosts, snippets, and credentials. Install with `npm install -g @termix-cli/cli` or grab a standalone binary. See the [CLI docs](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Security:**
Passwords, keys, and other secrets are encrypted per user, and the database files themselves can be encrypted on disk. See the [docs](https://docs.termix.site/security) for how it works.

</td>
<td width="50%" valign="top">

**Languages:**
Around 30 languages built in, managed through [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>More features</b></summary>
<br />

- **Dashboard** - Your servers at a glance, with cards you arrange yourself
- **Network Graph** - See your homelab drawn out from your hosts, with live status
- **Tmux Monitor** - Browse tmux sessions, windows, and panes, with previews and search
- **API Keys** - User-scoped keys with expiry dates for scripts and CI
- **Export and Import** - Move hosts, credentials, and file manager data in and out
- **Automatic SSL** - Certificates generated and renewed for you, with HTTPS redirects, or bring your own
- **Databases** - SQLite by default, with PostgreSQL and MySQL supported too
- **Modern UI** - Clean React interface that works on desktop and mobile, with themes like light, dark, and Dracula. Any connection can open full screen from a URL
- **Command Palette** - Double tap left shift to jump to a host from the keyboard
- **Keyboard Shortcuts** - Move between tabs, close tabs, and more, all rebindable
- **Wake-on-LAN** - Wake a machine from Termix or from an automation step
- **Trusted Proxy Auth** - Let a reverse proxy handle sign-in and pass the user through
- **SSH Feature Rich** - Jump hosts, Warpgate, TOTP prompts, SOCKS5, host key verification, password autofill, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, terminal logging, agent forwarding, Bitwarden SSH agent, HashiCorp Vault SSH signing, and more
- **Termix ID** - A built-in take on sshid.io. Claim a handle, publish your public keys at a resolver URL, and issue SSH certificates from the built-in CA

</details>

<br />

## Platform Support

<table align="center">
<tr>
<th align="center">Platform</th>
<th align="center">Distribution</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Any modern browser (Chrome, Safari, Firefox) · PWA support</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portable · MSI Installer · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portable · AUR · AppImage · Deb · Flatpak</td>
</tr>
<tr>
<td align="center"><b>macOS</b> <sub>x64/ia32, v12.0+</sub></td>
<td>Apple App Store · DMG · Homebrew</td>
</tr>
<tr>
<td align="center"><b>iOS/iPadOS</b> <sub>v15.1+</sub></td>
<td>Apple App Store · IPA</td>
</tr>
<tr>
<td align="center"><b>Android</b> <sub>v7.0+</sub></td>
<td>Google Play Store · APK</td>
</tr>
</table>

<br />

## Installation

Visit the [Termix Docs](https://docs.termix.site/install) for full installation instructions across all platforms.

Deploying to Kubernetes? The Helm chart is in `charts/termix`, and setup instructions
covering Ingress, Traefik, Argo CD, GitHub Actions, and GitLab CI are at
[docs.termix.site/install/server/kubernetes](https://docs.termix.site/install/server/kubernetes).

Sample Docker Compose file (you can omit `guacd` and the network if you don't plan on using remote desktop features):

```yaml
services:
  termix:
    image: ghcr.io/lukegus/termix:latest
    container_name: termix
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - termix-data:/app/data
    environment:
      PORT: "8080"
    depends_on:
      - guacd
    networks:
      - termix-net

  guacd:
    image: guacamole/guacd:1.6.0
    container_name: guacd
    restart: unless-stopped
    ports:
      - "4822:4822"
    networks:
      - termix-net

volumes:
  termix-data:
    driver: local

networks:
  termix-net:
    driver: bridge
```

### Behind a Reverse Proxy

Termix serves its UI through a bundled nginx that proxies to the Node backend on
loopback. Putting your own proxy (Traefik, Caddy, nginx, HAProxy) in front of it
works out of the box; these variables exist for the cases where it doesn't.

| Variable               | Default    | What it does                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_PROXIES`      | `loopback` | Which hops may set `X-Forwarded-For`, and therefore what Termix records as the client address in audit logs and login lockouts. Accepts IPs, CIDRs, the `loopback` / `linklocal` / `uniquelocal` presets (comma-separated), or `true` to trust every hop and `false` to trust none. |
| `FRAME_ANCESTORS`      | `'self'`   | Who may embed the Termix UI in an iframe, as a CSP `frame-ancestors` value.                                                                                                                                                                                                         |
| `CORS_ALLOWED_ORIGINS` | _(unset)_  | Extra browser origins allowed to call the API cross-origin, comma-separated. The origin Termix is served on is always allowed.                                                                                                                                                      |

**You normally do not need to set `TRUSTED_PROXIES`.** The default trusts only
loopback, which is what the bundled nginx connects from, and nginx appends the
address it saw — so the real client address still reaches Termix through one
extra proxy such as Traefik, and a client that sends its own `X-Forwarded-For`
cannot displace it. Set it only if you run the Node backend directly, without
the bundled nginx, in which case name the subnet your proxy connects from:

```yaml
TRUSTED_PROXIES: "loopback,172.16.0.0/12"
```

Every hop you list here is a hop that is allowed to claim to be someone else, so
keep the list as narrow as your topology allows.

One thing the default cannot cover: nginx believes forwarded headers from any
private address, so a client on your LAN that reaches the container port
directly — bypassing your proxy — can still choose the address it appears as. If
that matters, don't publish the port to your LAN at all and let only your proxy
reach it, with `expose: ["8080"]` instead of `ports:`.

### Configuration Files

Environment variables can also come from a `.env` file, which the backend reads
from two places, both before anything uses them:

- `.env` in the working directory — `/opt/termix/.env` on the Proxmox LXC install
- `$DATA_DIR/.env` — `/app/data/.env` in Docker, which lives on the data volume
  and therefore survives recreating the container

Precedence runs highest to lowest:

1. `$DATA_DIR/.env`
2. the real environment — a Compose `environment:` block, a systemd
   `EnvironmentFile=`, `docker run -e`
3. `.env` in the working directory

Note the order of the first two: `$DATA_DIR/.env` is applied on top of the
process environment rather than under it, so a value left over on the data
volume overrides the one in your Compose file. If a setting refuses to take
effect, check that file first.

### Command Line Interface

Termix also has a CLI, so you can manage your servers from a terminal and use Termix in your own scripts.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

It can open terminals, run a command on one host or a whole fleet, move files over SFTP, and manage hosts, snippets and credentials. Full documentation is at [docs.termix.site/cli](https://docs.termix.site/cli).

### Cloud Hosting

You can run the Termix server on a VPS instead of inside your own network. If Termix runs on the network it manages, an outage takes Termix down with it, right when you need it to fix things. Running it elsewhere keeps it reachable, gives you a static IP, and lets you get in from anywhere without a VPN or port forward.

[GINERNET](https://docs.termix.site/install/ginernet) sponsors Termix, and the docs have a step by step guide for deploying to their VPS platform.

<br />

## Telemetry

Termix sends a small anonymous ping once a day so I can see how many instances are running and which features get used. It contains a random instance ID, how many users and hosts you have, the app version, and which features (terminal, file manager, tunnels, docker, etc.) were used in the last 24 hours. It never contains usernames, hostnames, IP addresses, credentials, or anything else that identifies you or your servers.

It is on by default. Turn it off in Admin Settings under General, or set `ENABLE_TELEMETRY=false` before you ever start Termix.

<br />

## Donate

Termix is free and open source with no subscriptions or paid plans. If you find it useful, consider donating to help cover server costs, domains, and development time. Donations also help fund the time to research and learn what's needed to build features like SAML, Kubernetes, and Agent support. Track progress and donate below.

[Donate](https://donate.termix.site/)

<br />

## Sponsors

Interested in a paid placement to support development? Email [mail@termix.site](mailto:mail@termix.site).

<div align="center">

<br />

<a href="https://www.digitalocean.com/">
  <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" height="40" alt="DigitalOcean" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://crowdin.com/">
  <img src="https://support.crowdin.com/assets/logos/core-logo/svg/crowdin-core-logo-cDark.svg" height="40" alt="Crowdin" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.blacksmith.sh/">
  <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://sirv.sirv.com/website/screenshots/cloudflare/cloudflare-logo.png?w=300" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://rackgenius.com/rackgenius-logo.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://ginernet.com/img/logo-web.png" height="40" alt="Ginernet" />
</a>
</div>

<br />

## Support

Need help or want to request a feature? Open a [new issue](https://github.com/Termix-SSH/Support/issues) and add as much detail as you can, in English if possible. You can also ask in the support channel on [Discord](https://discord.gg/jVQGdvHDrf), though replies there can take longer.

<br />

## Screenshots

<div align="center">

<br />

[![YouTube](./docs/repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Watch update overviews on YouTube</sub>

<br />
<br />

<table>
<tr>
<td><img src="./docs/repo-images/Image 1.png" alt="Termix Screenshot 1" width="400" /></td>
<td><img src="./docs/repo-images/Image 2.png" alt="Termix Screenshot 2" width="400" /></td>
</tr>
<tr>
<td><img src="./docs/repo-images/Image 3.png" alt="Termix Screenshot 3" width="400" /></td>
<td><img src="./docs/repo-images/Image 4.png" alt="Termix Screenshot 4" width="400" /></td>
</tr>
<tr>
<td><img src="./docs/repo-images/Image 5.png" alt="Termix Screenshot 5" width="400" /></td>
<td><img src="./docs/repo-images/Image 6.png" alt="Termix Screenshot 6" width="400" /></td>
</tr>
<tr>
<td><img src="./docs/repo-images/Image 7.png" alt="Termix Screenshot 7" width="400" /></td>
<td><img src="./docs/repo-images/Image 8.png" alt="Termix Screenshot 8" width="400" /></td>
</tr>
<tr>
<td><img src="./docs/repo-images/Image 9.png" alt="Termix Screenshot 9" width="400" /></td>
<td><img src="./docs/repo-images/Image 10.png" alt="Termix Screenshot 10" width="400" /></td>
</tr>
<tr>
<td><img src="./docs/repo-images/Image 11.png" alt="Termix Screenshot 11" width="400" /></td>
<td><img src="./docs/repo-images/Image 12.png" alt="Termix Screenshot 12" width="400" /></td>
</tr>
<tr>
<td><img src="./docs/repo-images/Image 13.png" alt="Termix Screenshot 13" width="400" /></td>
<td><img src="./docs/repo-images/Image 14.png" alt="Termix Screenshot 14" width="400" /></td>
</tr>
<tr>
<td><img src="./docs/repo-images/Image 15.png" alt="Termix Screenshot 15" width="400" /></td>
<td><img src="./docs/repo-images/Image 16.png" alt="Termix Screenshot 16" width="400" /></td>
</tr>
</table>

<sub>Some videos and images may be out of date or may not perfectly showcase features.</sub>

</div>

<br />

## Planned Features

See [Projects](https://github.com/orgs/Termix-SSH/projects/5) for all planned features. If you are looking to contribute, see [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## License

Distributed under the Apache License Version 2.0. See `LICENSE` for more information.
