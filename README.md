<div align="center">

<img src="./public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Self-hosted server management</p>

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

<img src="./repo-images/HeaderImage.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Achieved on September 1st, 2025</sub>
</p>

</div>

<br />

<img src="./repo-images/header-overview.svg" alt="Overview" />

Termix is an open-source, forever-free, self-hosted all-in-one server management platform. It provides a multi-platform solution for managing your servers and infrastructure through a single, intuitive interface. Termix offers SSH terminal access, remote desktop control (RDP, VNC, Telnet), SSH tunneling capabilities, remote SSH file management, and many other tools. Termix is the perfect free and self-hosted alternative to Termius available for all platforms.

<br />

<img src="./repo-images/header-features.svg" alt="Features" />

<p><img src="./repo-images/features.svg" alt="Features" /></p>

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

<img src="./repo-images/header-platform-support.svg" alt="Platform Support" />

<p><img src="./repo-images/platform-support.svg" alt="Platform Support" /></p>

<br />

<img src="./repo-images/header-installation.svg" alt="Installation" />

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

<img src="./repo-images/header-screenshots.svg" alt="Screenshots" />

<div align="center">

<br />

[![YouTube](./repo-images/YouTube.jpg)](https://www.youtube.com/@TermixSSH/videos)

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
</table>

<sub>Some videos and images may be out of date or may not perfectly showcase features.</sub>

</div>

<br />

<img src="./repo-images/header-planned-features.svg" alt="Planned Features" />

See [Projects](https://github.com/orgs/Termix-SSH/projects/2) for all planned features. If you are looking to contribute, see [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

<img src="./repo-images/header-sponsors.svg" alt="Sponsors" />

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

<img src="./repo-images/header-support.svg" alt="Support" />

If you need help or want to request a feature with Termix, visit the [Issues](https://github.com/Termix-SSH/Support/issues) page, log in, and press `New Issue`. Please be as detailed as possible in your issue, preferably written in English. You can also join the [Discord](https://discord.gg/jVQGdvHDrf) server and visit the support channel, however, response times may be longer.

<br />

<img src="./repo-images/header-license.svg" alt="License" />

Distributed under the Apache License Version 2.0. See `LICENSE` for more information.
