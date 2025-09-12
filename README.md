# Repo Stats

<p align="center">
  <img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English | 
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/LukeGus/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/LukeGus/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/LukeGus/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

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

---

# Overview

<p align="center">
  <a href="https://github.com/LukeGus/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix is an open-source, forever-free, self-hosted all-in-one server management platform. It provides a web-based
solution for managing your servers and infrastructure through a single, intuitive interface. Termix offers SSH terminal
access, SSH tunneling capabilities, and remote file editing, with many more tools to come.

---

# Features

- **SSH Terminal Access** - Full-featured terminal with split-screen support (up to 4 panels) and tab system
- **SSH Tunnel Management** - Create and manage SSH tunnels with automatic reconnection and health monitoring
- **Remote File Editor** - Edit files directly on remote servers with syntax highlighting, file management features (
  uploading, removing, renaming, deleting files)
- **SSH Host Manager** - Save, organize, and manage your SSH connections with tags and folders
- **Server Stats** - View CPU, memory, and HDD usage on any SSH server
- **User Authentication** - Secure user management with admin controls and OIDC and 2FA (TOTP) support
- **Modern UI** - Clean desktop/mobile friendly (in progress) interface built with React, Tailwind CSS, and Shadcn
- **Languages** - Built-in support for English and Chinese
- **Improved Platform Support** - Now includes an installable Electron app (in progress) for desktop, with a dedicated
  mobile app also planned.

---

# Planned Features

See [Projects](https://github.com/users/LukeGus/projects/3). If you are looking to contribute,
see [Contributing](https://github.com/LukeGus/Termix/blob/main/CONTRIBUTING.md),

---

# Installation

Visit the Termix [Docs](https://docs.termix.site/install) for more information on how to install Termix. Otherwise, view
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

Pre-built binaries are now available for download, including a Windows installer/portable app and a Linux portable app (
built with Electron). See [Docs](http://localhost:5174/install#pre-built-binaries) for details. A native iOS/Android app
is planned.

---

# Support

If you need help with Termix, you can join the [Discord](https://discord.gg/jVQGdvHDrf) server and visit the support
channel. You can also open an issue or open a pull request on the [GitHub](https://github.com/LukeGus/Termix/issues)
repo.

---

# Show-off

<p align="center">
  <img src="./repo-images/Image 1.png" width="400" alt="Termix Demo 1"/>
  <img src="./repo-images/Image 2.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="./repo-images/Image 3.png" width="250" alt="Termix Demo 3"/>
  <img src="./repo-images/Image 4.png" width="250" alt="Termix Demo 4"/>
  <img src="./repo-images/Image 5.png" width="250" alt="Termix Demo 5"/>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/f9caa061-10dc-4173-ae7d-c6d42f05cf56" width="800" controls>
    Your browser does not support the video tag.
  </video>
</p>

---

# License

Distributed under the Apache License Version 2.0. See LICENSE for more information.
