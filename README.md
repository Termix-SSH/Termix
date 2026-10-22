<div align="center">

<img src="./public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Self-hosted, plugin-based server management</p>

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

<a href="https://www.youtube.com/watch?v=vhtkP-UqV5U"><img src="./.github/readme/overview.jpg" width="720" alt="Watch the Termix overview on YouTube" /></a>

</div>

<br />

## Overview

Termix is a free, open source, self-hosted server management platform built on plugins. The core keeps your hosts, credentials, users, sharing and sessions. Everything else, like the SSH terminal, remote desktop, file manager, Docker and metrics, is a plugin you can turn on, off or remove.

It runs on web, desktop and mobile. Think of it as a free, self-hosted Termius.

<br />

## Try the Demo

Try it at [demo.termix.site](https://demo.termix.site/). Any username and password works.

<br />

## Core

What every install has, with or without plugins:

- Hosts: Save hosts in nested folders with tags and parent hosts, bulk edit, import and export, and use Quick Connect for one-off connections
- Credentials: Reuse saved passwords and keys across hosts, with host defaults you can set for the server, a user or a folder
- Sharing and Roles: Share hosts, credentials and folders with users or roles at four levels: connect, view, edit and manage
- Accounts: Local accounts, sessions you can see and revoke, trusted devices, API keys and an audit log
- Security: Passwords, keys and other secrets are encrypted per user, and the database can be encrypted on disk
- Desktop Sync: The desktop app runs on its own and can link to a Termix server to keep an offline copy of your account
- Interface: Tabs and split screen, a command palette (double tap left shift), rebindable shortcuts, themes, branding and around 30 languages
- Databases: SQLite by default, with PostgreSQL and MySQL supported too

<br />

## Plugins

Plugins add everything else. The official ones ship with Termix, and admins can install, update or remove plugins from the Plugins tab. Each plugin has its own repo.

| Plugin                                                                      | What it does                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [ACME Certificates](https://github.com/Termix-SSH/Plugin-ACME-SSL)          | Gets the Termix HTTPS certificate from Let's Encrypt or any ACME provider and renews it for you.                                |
| [AI Assistant](https://github.com/Termix-SSH/Plugin-AI)                     | An AI assistant that reads your setup and proposes changes for you to approve.                                                  |
| [Alerts](https://github.com/Termix-SSH/Plugin-Alerts)                       | One inbox for every alert in Termix, with delivery to webhooks, ntfy, Discord and email.                                        |
| [Audit Tools](https://github.com/Termix-SSH/Plugin-Audit-Tools)             | Send the audit log to your SIEM and export it as CSV or NDJSON.                                                                 |
| [Automations](https://github.com/Termix-SSH/Plugin-Automations)             | Run steps on your hosts on a schedule or when something happens.                                                                |
| [Classic Layout](https://github.com/Termix-SSH/Plugin-Classic-Layout)       | The classic Termix layout with an icon rail, sidebar, tab bar and dock.                                                         |
| [Classic Themes](https://github.com/Termix-SSH/Plugin-Classic-Themes)       | Light, dark and seven more color themes for Termix.                                                                             |
| [Cloud Providers](https://github.com/Termix-SSH/Plugin-Cloud-Providers)     | Add hosts from AWS, Azure, Google Cloud, DigitalOcean, Hetzner and other clouds, and keep them in sync.                         |
| [Credential Tools](https://github.com/Termix-SSH/Plugin-Credential-Tools)   | Generate SSH keys, check them and copy a public key to a host.                                                                  |
| [Databases](https://github.com/Termix-SSH/Plugin-Databases)                 | Browse and edit MySQL, MariaDB, PostgreSQL and SQLite databases on your hosts from one tab.                                     |
| [Docker](https://github.com/Termix-SSH/Plugin-Docker)                       | Manage Docker and Podman containers on your hosts over SSH, with logs, stats and a console.                                     |
| [File Manager](https://github.com/Termix-SSH/Plugin-File-Manager)           | Browse, edit and move files over SFTP, including straight from one server to another.                                           |
| [Fleets](https://github.com/Termix-SSH/Plugin-Fleets)                       | Group hosts into fleets and run commands, package actions and file transfers on all of them at once.                            |
| [HashiCorp Vault](https://github.com/Termix-SSH/Plugin-Vault)               | Connect to hosts with short-lived SSH certificates signed by HashiCorp Vault.                                                   |
| [Homepage](https://github.com/Termix-SSH/Plugin-Homepage)                   | A drag and drop widget page for your servers and services, plus service links for the dashboard.                                |
| [Host Metrics](https://github.com/Termix-SSH/Plugin-Host-Metrics)           | Live CPU, memory, disk, network and GPU stats, plus tools to manage your hosts.                                                 |
| [Host Status](https://github.com/Termix-SSH/Plugin-Host-Status)             | Shows if each host is online with a dot in the host list, checked by connecting to its port.                                    |
| [Hosts Config](https://github.com/Termix-SSH/Plugin-Hosts-Config)           | Keep hosts, folders and sharing in a YAML or JSON file. Termix loads them as read only hosts and reloads when the file changes. |
| [Import and Export](https://github.com/Termix-SSH/Plugin-Import-Export)     | Import hosts from a JSON file or an SSH config file and export them to share or back up.                                        |
| [Kubernetes](https://github.com/Termix-SSH/Plugin-Kubernetes)               | Manage Kubernetes clusters from your hosts over SSH, with logs, metrics, YAML and a shell.                                      |
| [LDAP](https://github.com/Termix-SSH/Plugin-LDAP)                           | Sign in with your LDAP or Active Directory username and password.                                                               |
| [Login Security](https://github.com/Termix-SSH/Plugin-Login-Security)       | Sign people out when idle, limit session length, turn off remember me and require a second factor at login.                     |
| [Network Topology](https://github.com/Termix-SSH/Plugin-Network-Topology)   | Draws your hosts and the links between them as a live, interactive graph.                                                       |
| [OPKSSH](https://github.com/Termix-SSH/Plugin-OPKSSH)                       | Connect to hosts with short-lived OpenPubkey SSH certificates after signing in with your identity provider.                     |
| [Passkeys](https://github.com/Termix-SSH/Plugin-WebAuthn)                   | Sign in with a passkey or security key instead of a password.                                                                   |
| [Proxmox](https://github.com/Termix-SSH/Plugin-Proxmox)                     | Import Proxmox VE guests as hosts, keep them in sync and watch node stats.                                                      |
| [Remote Desktop](https://github.com/Termix-SSH/Plugin-Remote-Desktop)       | RDP, VNC and Telnet sessions in your browser, with clipboard, file transfer, sharing and recording.                             |
| [Reverse Proxy](https://github.com/Termix-SSH/Plugin-Reverse-Proxy)         | Reverse proxy for TCP, UDP, HTTP and HTTPS with free certificates and Termix login, managed per host.                           |
| [Samba Shares](https://github.com/Termix-SSH/Plugin-Samba)                  | Create and manage Samba (SMB) file shares, users and permissions on your hosts from one tab.                                    |
| [Secret Sources](https://github.com/Termix-SSH/Plugin-Secret-Sources)       | Pull host passwords and keys from 1Password when you connect instead of storing them in Termix.                                 |
| [Serial](https://github.com/Termix-SSH/Plugin-Serial)                       | Open a serial console to a router, switch or other device plugged into your computer.                                           |
| [Services](https://github.com/Termix-SSH/Plugin-Service-Manager)            | Manage services, timers and logs on your hosts over SSH.                                                                        |
| [Session Recording](https://github.com/Termix-SSH/Plugin-Session-Recording) | Record terminal and remote desktop sessions and play them back or download them later.                                          |
| [Session Sharing](https://github.com/Termix-SSH/Plugin-Session-Sharing)     | Share live sessions by link or with another user, and present sessions to a group in meeting rooms.                             |
| [Simple Layout](https://github.com/Termix-SSH/Plugin-Simple-Layout)         | A simple Termix layout for small setups with a top bar, a Home screen and only the basics.                                      |
| [Single sign-on](https://github.com/Termix-SSH/Plugin-SSO)                  | Sign in with any OpenID Connect provider, GitHub or Google.                                                                     |
| [Snippets](https://github.com/Termix-SSH/Plugin-Snippets)                   | Save the commands you run often and run them in a terminal or on many hosts in one click.                                       |
| [SSH Terminal](https://github.com/Termix-SSH/Plugin-SSH-Terminal)           | SSH terminal sessions with tabs, split screen, history, macros and a local terminal in the desktop app.                         |
| [Step CA](https://github.com/Termix-SSH/Plugin-Step-CA)                     | Connect to hosts with short-lived SSH certificates from a smallstep step-ca server.                                             |
| [Sync](https://github.com/Termix-SSH/Plugin-Sync)                           | Sync the desktop app with one or more servers, and manage other Termix servers as remote sites from a master.                   |
| [Tailscale](https://github.com/Termix-SSH/Plugin-Tailscale)                 | Add tailnet devices as hosts and connect with Tailscale SSH.                                                                    |
| [Termix Identity](https://github.com/Termix-SSH/Plugin-Termix-Identity)     | Publish your SSH public keys under a public handle and run your own SSH certificate authority.                                  |
| [Tmux Monitor](https://github.com/Termix-SSH/Plugin-Tmux-Monitor)           | Browse and control tmux sessions, windows and panes across your hosts.                                                          |
| [TOTP](https://github.com/Termix-SSH/Plugin-TOTP)                           | Two-factor sign in with a code from an authenticator app, with backup codes.                                                    |
| [Tunnels](https://github.com/Termix-SSH/Plugin-Tunnels)                     | SSH port forwarding that reconnects on its own, plus client tunnels from the desktop app.                                       |
| [Usage Statistics](https://github.com/Termix-SSH/Plugin-Telemetry)          | Sends a small anonymous daily report so we can see how Termix is used.                                                          |
| [Wake-on-LAN](https://github.com/Termix-SSH/Plugin-Wake-On-LAN)             | Wake sleeping machines by sending a Wake-on-LAN packet to their MAC address.                                                    |
| [Warpgate](https://github.com/Termix-SSH/Plugin-Warpgate)                   | Connect to hosts through a Warpgate SSH bastion.                                                                                |
| [Web Endpoint](https://github.com/Termix-SSH/Plugin-Web-Endpoint)           | Open a host's web UI inside Termix, directly or over an SSH tunnel.                                                             |
| [Workspaces](https://github.com/Termix-SSH/Plugin-Workspaces)               | Save your open tabs and split layouts and reopen them in one click.                                                             |

Want to build your own? Start from the [plugin template](https://github.com/Termix-SSH/Termix-Plugin-Template). Plugins you can install are listed in the [registry](https://github.com/Termix-SSH/Termix-Registry). Turn on the community registry in Plugins, Registries to install plugins made by other people, or add your own registry. See [submitting a plugin](https://docs.termix.site/develop/community-registry) and [hosting your own registry](https://docs.termix.site/develop/registries#host-your-own-registry).

<br />

## Platform Support

<table align="center">
<tr>
<th align="center">Platform</th>
<th align="center">Distribution</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Any modern browser (Chrome, Safari, Firefox) | PWA support</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portable | EXE and MSI Installer | Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/arm64/armv7l</sub></td>
<td>Portable | AUR | AppImage | Deb | Flatpak</td>
</tr>
<tr>
<td align="center"><b>macOS</b> <sub>Universal/x64/arm64, v12.0+</sub></td>
<td>Apple App Store | DMG | Homebrew</td>
</tr>
<tr>
<td align="center"><b>iOS/iPadOS</b> <sub>v15.1+</sub></td>
<td>Apple App Store | IPA</td>
</tr>
<tr>
<td align="center"><b>Android</b> <sub>v7.0+</sub></td>
<td>Google Play Store | APK</td>
</tr>
</table>

<br />

## Installation

See the [docs](https://docs.termix.site/install) for install steps on every platform.

Sample Docker Compose file. Remote desktop (RDP, VNC and Telnet) is built in, so nothing else needs to run next to it:

```yaml
services:
  termix:
    image: ghcr.io/termix-ssh/termix:latest
    container_name: termix
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - termix-data:/app/data
    environment:
      PORT: "8080"

volumes:
  termix-data:
    driver: local
```

### Cloud Hosting

If Termix runs on the network it manages, an outage takes it down right when you need it. A VPS keeps it reachable, gives you a static IP and works from anywhere without a VPN or port forward.

[GINERNET](https://docs.termix.site/install/ginernet) sponsors Termix and the docs have a setup guide for their VPS.

<br />

## Donate

Termix has no paid plans. Donations cover servers, domains and development time.

[Donate](https://donate.termix.site/)

<br />

## Sponsors

For a paid sponsor spot, email [mail@termix.site](mailto:mail@termix.site).

<!-- SPONSORS:START -->

<div align="center">

<br />

<a href="https://www.blacksmith.sh/">
  <img src="https://termix.site/img/sponsors/blacksmith.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://termix.site/img/sponsors/cloudflare.png" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://termix.site/img/sponsors/akamai.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://termix.site/img/sponsors/aws.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://termix.site/img/sponsors/rackgenius.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://termix.site/img/sponsors/ginernet.png" height="40" alt="Ginernet" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.hetzner.com/?mtm_campaign=termix&mtm_medium=referral&mtm_content=sponsoring_link">
  <img src="https://termix.site/img/sponsors/hetzner.png" height="40" alt="Hetzner" />
</a>

</div>

<!-- SPONSORS:END -->

<br />

## Support

Bugs and ideas for Termix itself (login, hosts, credentials, sharing, sync, the app and desktop app) go in this repo: [report a bug](https://github.com/Termix-SSH/Termix/issues/new?template=bug_report.yml) or [request a feature](https://github.com/Termix-SSH/Termix/issues/new?template=feature_request.yml).

Every plugin has its own repo, so a problem with the terminal, file manager, Docker, remote desktop or any other plugin goes in that plugin's repo (see the table above, or use Report an issue on the plugin's page in the app, which fills in your versions for you). Not sure where it goes? Open it here and it will be moved.

You need a GitHub account. Add as much detail as you can, in English if possible.

For discussions and questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server. Update videos are on [YouTube](https://www.youtube.com/@TermixSSH/videos).

<br />

## License

Apache License 2.0. See [LICENSE](LICENSE).
