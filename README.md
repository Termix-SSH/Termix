<div align="center">

<img src="./public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Self-hosted SSH management and remote desktop access</p>

<p>
  English ·
  <a href="readme/README-CN.md">中文</a> ·
  <a href="readme/README-JA.md">日本語</a> ·
  <a href="readme/README-KO.md">한국어</a> ·
  <a href="readme/README-FR.md">Français</a> ·
  <a href="readme/README-DE.md">Deutsch</a> ·
  <a href="readme/README-ES.md">Español</a> ·
  <a href="readme/README-PT.md">Português</a> ·
  <a href="readme/README-RU.md">Русский</a> ·
  <a href="readme/README-AR.md">العربية</a> ·
  <a href="readme/README-HI.md">हिन्दी</a> ·
  <a href="readme/README-TR.md">Türkçe</a> ·
  <a href="readme/README-VI.md">Tiếng Việt</a> ·
  <a href="readme/README-IT.md">Italiano</a>
</p>

<p>
  <img src="https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release&color=F39044&labelColor=1a1a1a&v=1" />
  <a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720?color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

<img src="./repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Achieved on September 1st, 2025</sub>
</p>

</div>

<br />

## Overview

Termix is an open-source, forever-free, self-hosted all-in-one server management platform. It provides a multi-platform solution for managing your servers and infrastructure through a single, intuitive interface. Termix offers SSH terminal access, remote desktop control (RDP, VNC, Telnet), SSH tunneling capabilities, remote file management, and many other tools. Termix is the perfect free and self-hosted alternative to Termius available for all platforms.

<br />

## Features

<table>
<tr>
<td width="50%" valign="top">

**SSH Terminal Access:**
Full-featured terminal with split-screen support (up to 4 panels) with a browser-like tab system. Includes support for customizing the terminal including common terminal themes, fonts, and other components.

</td>
<td width="50%" valign="top">

**Remote Desktop Access:**
RDP, VNC, and Telnet support over the browser with complete customization and split screening.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH Tunnel Management:**
Create and manage server-to-server SSH tunnels with automatic reconnection, health monitoring, and local, remote, or dynamic SOCKS forwarding. Desktop client-to-server tunnel settings are stored locally per desktop install, optional C2S preset snapshots can be saved to the server, renamed, loaded, or deleted when you want to move a local tunnel configuration between clients.

</td>
<td width="50%" valign="top">

**Remote File Manager:**
Manage files directly on remote servers with support for viewing and editing code, images, audio, and video. Upload, download, rename, delete, and move files seamlessly with sudo support. Includes support for moving files from server to server.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker Management:**
Start, stop, pause, remove containers. View container stats. Control container using docker exec terminal. It was not made to replace Portainer or Dockge but rather to simply manage your containers compared to creating them.

</td>
<td width="50%" valign="top">

**SSH Host Manager:**
Save, organize, and manage your SSH connections with tags and folders, and easily save reusable login info while being able to automate the deployment of SSH keys.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Server Stats:**
View CPU, memory, and disk usage along with network, uptime, system information, firewall, port monitor, on most Linux based servers.

</td>
<td width="50%" valign="top">

**User Authentication:**
Secure user management with admin controls and OIDC (with access control) and 2FA (TOTP) support. View active user sessions across all platforms and revoke permissions. Link your OIDC/Local accounts together.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
Create roles and share hosts across users/roles.

</td>
<td width="50%" valign="top">

**Database Encryption:**
Backend stored as encrypted SQLite database files. View [docs](https://docs.termix.site/security) for more.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Network Graph:**
Customize your Dashboard to visualize your homelab based off your SSH connections with status support.

</td>
<td width="50%" valign="top">

**SSH Tools:**
Create reusable command snippets that execute with a single click. Run one command simultaneously across multiple open terminals.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Persistent Tabs:**
SSH sessions and tabs stay open across devices/refreshes if enabled in user profile.

</td>
<td width="50%" valign="top">

**Languages:**
Built-in support ~30 languages (managed by [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>More features</b></summary>
<br />

- **Dashboard** - View server information at a glance on your dashboard
- **API Keys** - Create user-scoped API keys with expiration dates to be used for automation/CI
- **Data Export/Import** - Export and import SSH hosts, credentials, and file manager data
- **Automatic SSL Setup** - Built-in SSL certificate generation and management with HTTPS redirects
- **Modern UI** - Clean desktop/mobile-friendly interface built with React, Tailwind CSS, and Shadcn. Choose between many different UI themes including light, dark, Dracula, etc. Use URL routes to open any connection in full-screen.
- **Command History** - Auto-complete and view previously ran SSH commands
- **Quick Connect** - Connect to a server without having to save the connection data
- **Command Palette** - Double tap left shift to quickly access SSH connections with your keyboard
- **SSH Feature Rich** - Supports jump hosts, Warpgate, TOTP based connections, SOCKS5, host key verification, password autofill, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, etc.

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

<br />

## Screenshots

<div align="center">

<br />

[![YouTube](./repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Watch update overviews on YouTube</sub>

<br />
<br />

<table>
<tr>
<td><img src="./repo-images/Image 1.png" alt="Termix Screenshot 1" width="400" /></td>
<td><img src="./repo-images/Image 2.png" alt="Termix Screenshot 2" width="400" /></td>
</tr>
<tr>
<td><img src="./repo-images/Image 3.png" alt="Termix Screenshot 3" width="400" /></td>
<td><img src="./repo-images/Image 4.png" alt="Termix Screenshot 4" width="400" /></td>
</tr>
<tr>
<td><img src="./repo-images/Image 5.png" alt="Termix Screenshot 5" width="400" /></td>
<td><img src="./repo-images/Image 6.png" alt="Termix Screenshot 6" width="400" /></td>
</tr>
<tr>
<td><img src="./repo-images/Image 7.png" alt="Termix Screenshot 7" width="400" /></td>
<td><img src="./repo-images/Image 8.png" alt="Termix Screenshot 8" width="400" /></td>
</tr>
<tr>
<td><img src="./repo-images/Image 9.png" alt="Termix Screenshot 9" width="400" /></td>
<td><img src="./repo-images/Image 10.png" alt="Termix Screenshot 10" width="400" /></td>
</tr>
<tr>
<td><img src="./repo-images/Image 11.png" alt="Termix Screenshot 11" width="400" /></td>
<td><img src="./repo-images/Image 12.png" alt="Termix Screenshot 12" width="400" /></td>
</tr>
<tr>
<td><img src="./repo-images/Image 13.png" alt="Termix Screenshot 13" width="400" /></td>
<td><img src="./repo-images/Image 14.png" alt="Termix Screenshot 14" width="400" /></td>
</tr>
</table>

<sub>Some videos and images may be out of date or may not perfectly showcase features.</sub>

</div>

<br />

## Planned Features

See [Projects](https://github.com/orgs/Termix-SSH/projects/5) for all planned features. If you are looking to contribute, see [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Sponsors

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
<a href="https://tailscale.com/">
  <img src="https://drive.google.com/uc?export=view&id=1lIxkJuX6M23bW-2FElhT0rQieTrzaVSL" height="40" alt="Tailscale" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="40" alt="AWS" />
</a>

</div>

<br />

## Support

If you need help or want to request a feature with Termix, visit the [Issues](https://github.com/Termix-SSH/Support/issues) page, log in, and press `New Issue`. Please be as detailed as possible in your issue, preferably written in English. You can also join the [Discord](https://discord.gg/jVQGdvHDrf) server and visit the support channel, however, response times may be longer.

<br />

## License

Distributed under the Apache License Version 2.0. See `LICENSE` for more information.
