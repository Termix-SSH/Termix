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

</div>

<br />

## Overview

Termix is a free, open source, self-hosted platform for managing your servers, built on plugins. The core is small. It keeps your hosts, credentials, users, sharing and sessions. Everything else, like the SSH terminal, remote desktop, file manager, Docker and metrics, is a plugin you can turn on, turn off or remove.

It runs on web, desktop and mobile, and it is a self-hosted alternative to Termius that stays free forever.

<br />

## Try the Demo

Want to see it before you install it? Try the demo at [demo.termix.site](https://demo.termix.site/). Any username and password works.

<br />

## Core

What every Termix install has, with or without plugins:

- **Hosts:** Save hosts in nested folders with tags and parent hosts, bulk edit, import and export, and use Quick Connect for one-off connections
- **Credentials:** Reuse saved passwords and keys across hosts, with host defaults you can set for the server, a user or a folder
- **Sharing and Roles:** Share hosts, credentials and folders with users or roles at four levels: connect, view, edit and manage
- **Accounts:** Local accounts, sessions you can see and revoke, trusted devices, API keys and an audit log
- **Security:** Passwords, keys and other secrets are encrypted per user, and the database can be encrypted on disk
- **Desktop Sync:** The desktop app runs on its own and can link to a Termix server to keep an offline copy of your account
- **Interface:** Tabs and split screen, a command palette (double tap left shift), rebindable shortcuts, themes, branding and around 30 languages
- **Databases:** SQLite by default, with PostgreSQL and MySQL supported too

<br />

## Plugins

Plugins add everything else. The official ones ship with Termix, and admins can install, update or remove plugins from the Plugins tab. Each plugin has its own repo.

| Plugin                                                                      | What it does                                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [ACME Certificates](https://github.com/Termix-SSH/Plugin-ACME-SSL)          | Gets the Termix HTTPS certificate from Let's Encrypt or any ACME provider and renews it for you.            |
| [AI Assistant](https://github.com/Termix-SSH/Plugin-AI)                     | An AI assistant that reads your setup and proposes changes for you to approve.                              |
| [Alerts](https://github.com/Termix-SSH/Plugin-Alerts)                       | One inbox for every alert in Termix, with delivery to webhooks, ntfy, Discord and email.                    |
| [Automations](https://github.com/Termix-SSH/Plugin-Automations)             | Run steps on your hosts on a schedule or when something happens.                                            |
| [Docker](https://github.com/Termix-SSH/Plugin-Docker)                       | Manage Docker and Podman containers on your hosts over SSH, with logs, stats and a console.                 |
| [File Manager](https://github.com/Termix-SSH/Plugin-File-Manager)           | Browse, edit and move files over SFTP, including straight from one server to another.                       |
| [Fleets](https://github.com/Termix-SSH/Plugin-Fleets)                       | Group hosts into fleets and run commands, package actions and file transfers on all of them at once.        |
| [HashiCorp Vault](https://github.com/Termix-SSH/Plugin-Vault)               | Connect to hosts with short-lived SSH certificates signed by HashiCorp Vault.                               |
| [Homepage](https://github.com/Termix-SSH/Plugin-Homepage)                   | A drag and drop widget page for your servers and services, plus service links for the dashboard.            |
| [Host Metrics](https://github.com/Termix-SSH/Plugin-Host-Metrics)           | Live CPU, memory, disk, network and GPU stats, plus tools to manage your hosts.                             |
| [LDAP](https://github.com/Termix-SSH/Plugin-LDAP)                           | Sign in with your LDAP or Active Directory username and password.                                           |
| [Network Topology](https://github.com/Termix-SSH/Plugin-Network-Topology)   | Draws your hosts and the links between them as a live, interactive graph.                                   |
| [OPKSSH](https://github.com/Termix-SSH/Plugin-OPKSSH)                       | Connect to hosts with short-lived OpenPubkey SSH certificates after signing in with your identity provider. |
| [Passkeys](https://github.com/Termix-SSH/Plugin-WebAuthn)                   | Sign in with a passkey or security key instead of a password.                                               |
| [Proxmox](https://github.com/Termix-SSH/Plugin-Proxmox)                     | Import Proxmox VE guests as hosts, keep them in sync and watch node stats.                                  |
| [Remote Desktop](https://github.com/Termix-SSH/Plugin-Remote-Desktop)       | RDP, VNC and Telnet sessions in your browser, with clipboard, file transfer, sharing and recording.         |
| [Secret Sources](https://github.com/Termix-SSH/Plugin-Secret-Sources)       | Pull host passwords and keys from 1Password when you connect instead of storing them in Termix.             |
| [Serial](https://github.com/Termix-SSH/Plugin-Serial)                       | Open a serial console to a router, switch or other device plugged into your computer.                       |
| [Session Recording](https://github.com/Termix-SSH/Plugin-Session-Recording) | Record terminal and remote desktop sessions and play them back or download them later.                      |
| [Session Sharing](https://github.com/Termix-SSH/Plugin-Session-Sharing)     | Share live sessions by link or with another user, and present sessions to a group in meeting rooms.         |
| [Single sign-on](https://github.com/Termix-SSH/Plugin-SSO)                  | Sign in with any OpenID Connect provider, GitHub or Google.                                                 |
| [Snippets](https://github.com/Termix-SSH/Plugin-Snippets)                   | Save the commands you run often and run them in a terminal or on many hosts in one click.                   |
| [SSH Terminal](https://github.com/Termix-SSH/Plugin-SSH-Terminal)           | SSH terminal sessions with tabs, split screen, history, macros and a local terminal in the desktop app.     |
| [Step CA](https://github.com/Termix-SSH/Plugin-Step-CA)                     | Connect to hosts with short-lived SSH certificates from a smallstep step-ca server.                         |
| [Tailscale](https://github.com/Termix-SSH/Plugin-Tailscale)                 | Add tailnet devices as hosts and connect with Tailscale SSH.                                                |
| [Termix Identity](https://github.com/Termix-SSH/Plugin-Termix-Identity)     | Publish your SSH public keys under a public handle and run your own SSH certificate authority.              |
| [Tmux Monitor](https://github.com/Termix-SSH/Plugin-Tmux-Monitor)           | Browse and control tmux sessions, windows and panes across your hosts.                                      |
| [TOTP](https://github.com/Termix-SSH/Plugin-TOTP)                           | Two-factor sign in with a code from an authenticator app, with backup codes.                                |
| [Tunnels](https://github.com/Termix-SSH/Plugin-Tunnels)                     | SSH port forwarding that reconnects on its own, plus client tunnels from the desktop app.                   |
| [Usage Statistics](https://github.com/Termix-SSH/Plugin-Telemetry)          | Sends a small anonymous daily report so we can see how Termix is used.                                      |
| [Wake-on-LAN](https://github.com/Termix-SSH/Plugin-Wake-On-LAN)             | Wake sleeping machines by sending a Wake-on-LAN packet to their MAC address.                                |
| [Warpgate](https://github.com/Termix-SSH/Plugin-Warpgate)                   | Connect to hosts through a Warpgate SSH bastion.                                                            |
| [Web Endpoint](https://github.com/Termix-SSH/Plugin-Web-Endpoint)           | Open a host's web UI inside Termix, directly or over an SSH tunnel.                                         |
| [Workspaces](https://github.com/Termix-SSH/Plugin-Workspaces)               | Save your open tabs and split layouts and reopen them in one click.                                         |

Want to build your own? Start from the [plugin template](https://github.com/Termix-SSH/Termix-Plugin-Template). Plugins you can install are listed in the [registry](https://github.com/Termix-SSH/Termix-Registry). Its community registry is open for submissions now, and Termix will be able to install community plugins in a later update. See [submitting a plugin](https://docs.termix.site/develop/community-registry).

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

Visit the [Termix Docs](https://docs.termix.site/install) for full install steps on every platform.

Sample Docker Compose file (you can leave out `guacd` and the network if you don't plan to use the Remote Desktop plugin):

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
      GUACD_HOST: "guacd"
      GUACD_TUNNEL_HOST: "termix"
      GUACD_RECORDING_PATH: "/termix-data/session_recordings/guacamole"
      GUACD_DRIVE_PATH: "/termix-data/rdp-drive"
    depends_on:
      - guacd
    networks:
      - termix-net

  guacd:
    image: guacamole/guacd:1.6.0
    container_name: guacd
    restart: unless-stopped
    volumes:
      - termix-data:/termix-data
    networks:
      - termix-net

volumes:
  termix-data:
    driver: local

networks:
  termix-net:
    driver: bridge
```

### Cloud Hosting

You can run Termix on a VPS instead of inside your own network. If Termix runs on the network it manages, an outage takes Termix down with it, right when you need it to fix things. Running it somewhere else keeps it reachable, gives you a static IP and lets you get in from anywhere without a VPN or port forward.

[GINERNET](https://docs.termix.site/install/ginernet) sponsors Termix, and the docs have a step by step guide for their VPS platform.

<br />

## Donate

Termix is free and open source with no subscriptions or paid plans. If you find it useful, consider donating to help cover server costs, domains and development time.

[Donate](https://donate.termix.site/)

<br />

## Sponsors

Interested in a paid placement to support development? Email [mail@termix.site](mailto:mail@termix.site).

<!-- SPONSORS:START -->

<div align="center">

<br />

<a href="https://www.digitalocean.com/">
  <img src="https://termix.site/img/sponsors/digitalocean.svg" height="40" alt="DigitalOcean" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://crowdin.com/">
  <img src="https://termix.site/img/sponsors/crowdin.svg" height="40" alt="Crowdin" />
</a>
&nbsp;&nbsp;&nbsp;
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

You need to be logged in to GitHub. Please be as detailed as possible, preferably in English.

For discussions and questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server. Update videos are on [YouTube](https://www.youtube.com/@TermixSSH/videos).

<br />

## License

Distributed under the Apache License Version 2.0. See [LICENSE](LICENSE) for more information.
