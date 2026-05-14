<div align="center">

<img src="./public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>
  <span style="color:#F39044;">Termix</span>
</h1>

<p>Open-source · Forever free · Self-hosted server management</p>

<p>
  🇺🇸 English ·
  <a href="readme/README-CN.md">🇨🇳 中文</a> ·
  <a href="readme/README-JA.md">🇯🇵 日本語</a> ·
  <a href="readme/README-KO.md">🇰🇷 한국어</a> ·
  <a href="readme/README-FR.md">🇫🇷 Français</a> ·
  <a href="readme/README-DE.md">🇩🇪 Deutsch</a> ·
  <a href="readme/README-ES.md">🇪🇸 Español</a> ·
  <a href="readme/README-PT.md">🇧🇷 Português</a> ·
  <a href="readme/README-RU.md">🇷🇺 Русский</a> ·
  <a href="readme/README-AR.md">🇸🇦 العربية</a> ·
  <a href="readme/README-HI.md">🇮🇳 हिन्दी</a> ·
  <a href="readme/README-TR.md">🇹🇷 Türkçe</a> ·
  <a href="readme/README-VI.md">🇻🇳 Tiếng Việt</a> ·
  <a href="readme/README-IT.md">🇮🇹 Italiano</a>
</p>

<p>
  <img src="https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release&color=F39044&labelColor=1a1a1a&v=1" />
  <a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720?color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

<img src="./repo-images/HeaderImage.png" alt="Termix Banner" style="max-width: 900px; width: 100%; border-radius: 12px;" />

<br />
<br />

<p>
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Achieved on September 1st, 2025</sub>
</p>

</div>

---

## What is Termix?

Termix is an open-source, forever-free, self-hosted all-in-one server management platform. It gives you a single, clean interface to manage your servers and infrastructure across any platform — SSH terminal access, remote desktop (RDP, VNC, Telnet), SSH tunneling, remote file management, and a lot more. Think of it as a free, self-hosted Termius alternative that actually runs everywhere.

---

## Features

<table>
<tr>
<td width="50%" valign="top">

**🖥️ SSH Terminal**
Full-featured terminal with split-screen support (up to 4 panels) and a browser-like tab system. Customize themes, fonts, and terminal components to your liking.

**🖱️ Remote Desktop**
RDP, VNC, and Telnet support directly in the browser with full customization and split screening.

**🔒 SSH Tunneling**
Create and manage server-to-server SSH tunnels with automatic reconnection, health monitoring, and local, remote, or dynamic SOCKS forwarding. Desktop client-to-server settings are stored locally per install — optional C2S preset snapshots can be saved to the server and loaded from any client.

**📁 Remote File Manager**
Manage files on remote servers with support for viewing and editing code, images, audio, and video. Upload, download, rename, delete, and move files seamlessly with sudo support.

**🐳 Docker Management**
Start, stop, pause, and remove containers. View container stats and control them with a docker exec terminal. Not a Portainer replacement — just a clean way to manage containers.

**🗂️ SSH Host Manager**
Save, organize, and manage your SSH connections with tags and folders. Save reusable login info and automate SSH key deployment.

</td>
<td width="50%" valign="top">

**📊 Server Stats**
View CPU, memory, and disk usage along with network, uptime, system info, firewall, and port monitoring on most Linux-based servers.

**🔑 User Authentication**
Secure user management with admin controls, OIDC (with access control), and 2FA (TOTP) support. View and revoke active sessions across all platforms. Link OIDC and local accounts together.

**🛡️ RBAC**
Create roles and share hosts across users and roles with fine-grained permissions.

**🔐 Database Encryption**
Backend stored as encrypted SQLite database files. See [docs](https://docs.termix.site/security) for details.

**🌐 Network Graph**
Visualize your homelab based on your SSH connections with live status support.

**🔧 SSH Tools**
Create reusable command snippets that run with a single click. Execute one command simultaneously across multiple open terminals.

**📌 Persistent Tabs**
SSH sessions and tabs stay open across devices and refreshes when enabled in your profile.

**🌍 30+ Languages**
Built-in support for ~30 languages, managed by [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<details>
<summary><b>More features</b></summary>
<br />

- **Dashboard** — View server information at a glance
- **API Keys** — Create user-scoped API keys with expiration dates for automation and CI
- **Data Export/Import** — Export and import SSH hosts, credentials, and file manager data
- **Automatic SSL Setup** — Built-in SSL certificate generation with HTTPS redirects
- **Command History** — Auto-complete and view previously run SSH commands
- **Quick Connect** — Connect to a server without saving it first
- **Command Palette** — Double-tap left Shift to quickly find and open connections from the keyboard
- **SSH Feature Rich** — Jump hosts, Warpgate, TOTP-based connections, SOCKS5, host key verification, password autofill, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, and more
- **Modern UI** — Clean desktop/mobile-friendly UI built with React, Tailwind CSS, and Shadcn. Multiple themes including light, dark, Dracula, etc. Full-screen URL routes for any connection

</details>

---

## Platform Support

<div align="center">

|           Platform           | Distribution                                               |
| :--------------------------: | :--------------------------------------------------------- |
|           **Web**            | Any modern browser (Chrome, Safari, Firefox) · PWA support |
|    **Windows** (x64/ia32)    | Portable · MSI Installer · Chocolatey                      |
|     **Linux** (x64/ia32)     | Portable · AUR · AppImage · Deb · Flatpak                  |
| **macOS** (x64/ia32, v12.0+) | Apple App Store · DMG · Homebrew                           |
|   **iOS/iPadOS** (v15.1+)    | Apple App Store · IPA                                      |
|     **Android** (v7.0+)      | Google Play Store · APK                                    |

</div>

---

## Installation

Visit the [Termix Docs](https://docs.termix.site/install) for full installation instructions across all platforms.

Sample Docker Compose file (you can omit `guacd` and the network if you don't need remote desktop):

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

---

## Screenshots

<div align="center">

[![YouTube](./repo-images/YouTube.jpg)](https://www.youtube.com/@TermixSSH/videos)

<sub>Watch the full overview on YouTube</sub>

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
</table>

<sub>Some videos and images may be out of date or may not perfectly showcase all features.</sub>

</div>

---

## Planned Features

See [Projects](https://github.com/orgs/Termix-SSH/projects/2) for all planned features. If you want to contribute, check out [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

---

## Sponsors

<div align="center">

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

---

## Support

Need help or want to request a feature? Head to the [Issues](https://github.com/Termix-SSH/Support/issues) page and open a new issue — the more detail the better, and English is preferred. You can also join the [Discord](https://discord.gg/jVQGdvHDrf) server, though response times there may be longer.

---

## License

Distributed under the Apache License Version 2.0. See `LICENSE` for more information.
