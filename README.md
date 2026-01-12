# Repo Stats

<p align="center">
  <img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English | 
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Achieved on September 1st, 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

If you would like, you can support the project here!\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# Overview

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix is an open-source, forever-free, self-hosted all-in-one server management platform. It provides a multi-platform
solution for managing your servers and infrastructure through a single, intuitive interface. Termix offers SSH terminal
access, SSH tunneling capabilities, and remote file management, with many more tools to come. Termix is the perfect
free and self-hosted alternative to Termius available for all platforms.

# Features

- **SSH Terminal Access** - Full-featured terminal with split-screen support (up to 4 panels) with a browser-like tab system. Includes support for customizing the terminal including common terminal themes, fonts, and other components
- **SSH Tunnel Management** - Create and manage SSH tunnels with automatic reconnection and health monitoring
- **Remote File Manager** - Manage files directly on remote servers with support for viewing and editing code, images, audio, and video. Upload, download, rename, delete, and move files seamlessly
- **SSH Host Manager** - Save, organize, and manage your SSH connections with tags and folders, and easily save reusable login info while being able to automate the deployment of SSH keys
- **Server Stats** - View CPU, memory, and disk usage along with network, uptime, and system information on any SSH server
- **Dashboard** - View server information at a glance on your dashboard
- **User Authentication** - Secure user management with admin controls and OIDC and 2FA (TOTP) support. View active user sessions across all platforms and revoke permissions. Link your OIDC/Local accounts together.
- **Database Encryption** - Backend stored as encrypted SQLite database files. View [docs](https://docs.termix.site/security) for more.
- **Data Export/Import** - Export and import SSH hosts, credentials, and file manager data
- **Automatic SSL Setup** - Built-in SSL certificate generation and management with HTTPS redirects
- **Modern UI** - Clean desktop/mobile-friendly interface built with React, Tailwind CSS, and Shadcn
- **Languages** - Built-in support for English, Chinese, German, and Portuguese
- **Platform Support** - Available as a web app, desktop application (Windows, Linux, and macOS), and dedicated mobile/tablet app for iOS and Android.
- **SSH Tools** - Create reusable command snippets that execute with a single click. Run one command simultaneously across multiple open terminals.
- **Command History** - Auto-complete and view previously ran SSH commands
- **Command Palette** - Double tap left shift to quickly access SSH connections with your keyboard
- **SSH Feature Rich** - Supports jump hosts, warpgate, TOTP based connections, etc.

# Planned Features

See [Projects](https://github.com/orgs/Termix-SSH/projects/2) for all planned features. If you are looking to contribute, see [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Installation

Supported Devices:

- Website (any modern browser on any platform like Chrome, Safari, and Firefox)
- Windows (x64/ia32)
  - Portable
  - MSI Installer
  - Chocolatey Package Manager
- Linux (x64/ia32)
  - Portable [(AUR available)](https://aur.archlinux.org/packages/termix-bin)
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 on v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - ISO
- Android (v7.0+)
  - Google Play Store
  - APK

Visit the Termix [Docs](https://docs.termix.site/install) for more information on how to install Termix on all platforms. Otherwise, view
a sample Docker Compose file here:

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

volumes:
  termix-data:
    driver: local
```

# Sponsors

Thank you to [Digital Ocean](https://www.digitalocean.com/) for sponsoring Termix and covering our documentation server costs!

<img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/PoweredByDO/DO_Powered_by_Badge_blue.svg" alt="Powered by DigitalOcean" width="300" height="200">

# Support

If you need help or want to request a feature with Termix, visit the [Issues](https://github.com/Termix-SSH/Support/issues) page, log in, and press `New Issue`.
Please be as detailed as possible in your issue, preferably written in English. You can also join the [Discord](https://discord.gg/jVQGdvHDrf) server and visit the support
channel, however, response times may be longer.

# Show-off

<p align="center">
  <img src="./repo-images/Image 1.png" width="400" alt="Termix Demo 1"/>
  <img src="./repo-images/Image 2.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="./repo-images/Image 3.png" width="400" alt="Termix Demo 3"/>
  <img src="./repo-images/Image 4.png" width="400" alt="Termix Demo 4"/>
</p>

<p align="center">
  <img src="./repo-images/Image 5.png" width="400" alt="Termix Demo 5"/>
  <img src="./repo-images/Image 6.png" width="400" alt="Termix Demo 6"/>
</p>

<p align="center">
  <img src="./repo-images/Image 7.png" width="400" alt="Termix Demo 7"/>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/88936e0d-2399-4122-8eee-c255c25da48c" width="800" controls>
    Your browser does not support the video tag.
  </video>
</p>
Videos and images may be out of date.

# License

Distributed under the Apache License Version 2.0. See LICENSE for more information.
