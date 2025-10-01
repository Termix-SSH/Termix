# Repo Stats

<p align="center">
  <img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English | 
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/LukeGus/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/LukeGus/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/LukeGus/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Achieved on September 1st, 2025</small>
</p>

#### Top Technologies

[![React Badge](https://img.shields.io/badge/-React-61DBFB?style=flat-square&labelColor=black&logo=react&logoColor=61DBFB)](#)
[![TypeScript Badge](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&labelColor=black&logo=typescript&logoColor=3178C6)](#)
[![Node.js Badge](https://img.shields.io/badge/-Node.js-3C873A?style=flat-square&labelColor=black&logo=node.js&logoColor=3C873A)](#)
[![Vite Badge](https://img.shields.io/badge/-Vite-646CFF?style=flat-square&labelColor=black&logo=vite&logoColor=646CFF)](#)
[![Tailwind CSS Badge](https://img.shields.io/badge/-TailwindCSS-38B2AC?style=flat-square&labelColor=black&logo=tailwindcss&logoColor=38B2AC)](#)
[![Docker Badge](https://img.shields.io/badge/-Docker-2496ED?style=flat-square&labelColor=black&logo=docker&logoColor=2496ED)](#)
[![SQLite Badge](https://img.shields.io/badge/-SQLite-003B57?style=flat-square&labelColor=black&logo=sqlite&logoColor=003B57)](#)
[![Radix UI Badge](https://img.shields.io/badge/-Radix%20UI-161618?style=flat-square&labelColor=black&logo=radixui&logoColor=161618)](#)

<br />
<p align="center">
  <a href="https://github.com/LukeGus/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

If you would like, you can support the project here!\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# Overview

<p align="center">
  <a href="https://github.com/LukeGus/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix is an open-source, forever-free, self-hosted all-in-one server management platform. It provides a web-based
solution for managing your servers and infrastructure through a single, intuitive interface. Termix offers SSH terminal
access, SSH tunneling capabilities, remote file management, with many more tools to come.

# Features

- **SSH Terminal Access** - Full-featured terminal with split-screen support (up to 4 panels) and tab system
- **SSH Tunnel Management** - Create and manage SSH tunnels with automatic reconnection and health monitoring
- **Remote File Manager** - Manage files directly on remote servers with support for viewing and editing code, images, audio, and video. Upload, download, rename, delete, and move files seamlessly.
- **SSH Host Manager** - Save, organize, and manage your SSH connections with tags and folders and easily save reusable login info while being able to automate the deploying of SSH keys
- **Server Stats** - View CPU, memory, and HDD usage on any SSH server
- **User Authentication** - Secure user management with admin controls and OIDC and 2FA (TOTP) support
- **Database Encryption** - SQLite database files encrypted at rest with automatic encryption/decryption
- **Data Export/Import** - Export and import SSH hosts, credentials, and file manager data with incremental sync
- **Automatic SSL Setup** - Built-in SSL certificate generation and management with HTTPS redirects
- **Modern UI** - Clean desktop/mobile friendly interface built with React, Tailwind CSS, and Shadcn
- **Languages** - Built-in support for English and Chinese
- **Platform Support** - Available as a web app, desktop application (Windows & Linux), and dedicated mobile app for iOS and Android (coming in a few days)

# Planned Features

See [Projects](https://github.com/users/LukeGus/projects/3) for all planned features. If you are looking to contribute, see [Contributing](https://github.com/LukeGus/Termix/blob/main/CONTRIBUTING.md).

# Installation

Supported Devices:

- Website (any modern browser like Google, Safari, and Firefox)
- Windows (app)
- Linux (app)
- iOS (coming in a few days)
- Android (coming in a few days)
- iPadOS and macOS are in progress

Visit the Termix [Docs](https://docs.termix.site/install) for more information on how to install Termix on all platforms. Otherwise, view
a sample docker-compose file here:

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

# Support

If you need help with Termix, you can join the [Discord](https://discord.gg/jVQGdvHDrf) server and visit the support
channel. You can also open an issue or open a pull request on the [GitHub](https://github.com/LukeGus/Termix/issues)
repo.

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
  <video src="https://github.com/user-attachments/assets/88936e0d-2399-4122-8eee-c255c25da48c" width="800" controls>
    Your browser does not support the video tag.
  </video>
</p>

# License

Distributed under the Apache License Version 2.0. See LICENSE for more information.
